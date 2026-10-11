import { AsyncLocalStorage } from 'node:async_hooks';
import { sqlClient } from '../db/client';

export type Operation = { kind: string; id: string; signal?: AbortSignal };
const context = new AsyncLocalStorage<Operation>();
export const currentOperation = () => context.getStore();
export const withOperation = <T>(
  operation: Operation,
  work: () => Promise<T>,
) => {
  const signal = ['interpret', 'chronicle', 'summary'].includes(operation.kind)
    ? AbortSignal.any([
        AbortSignal.timeout(4 * 60 * 60 * 1000),
        ...(operation.signal ? [operation.signal] : []),
      ])
    : operation.signal;
  return context.run({ ...operation, signal }, async () => await work());
};

export const jobKinds = {
  interpret: {
    table: 'interpretation_runs',
    outbox: 'job_outbox',
    lock: 72418,
    legacyLock: 736506,
  },
  chronicle: {
    table: 'push_batches',
    outbox: 'chronicler_outbox',
    lock: 72419,
    legacyLock: 736507,
  },
  research: { table: 'research_runs', outbox: 'research_outbox', lock: 736504 },
  translation: {
    table: 'transcript_translations',
    outbox: 'translation_outbox',
    lock: 72417,
  },
  summary: {
    table: 'meeting_summaries',
    outbox: 'summary_outbox',
    lock: 72420,
  },
} as const;

/** A database session lease survives slow model calls and disappears on process death. */
export async function leasedOperation<T>(
  kind: 'interpret' | 'chronicle',
  id: string,
  work: () => Promise<T>,
) {
  const session = await sqlClient.reserve(),
    spec = jobKinds[kind];
  let locked = false,
    timer: ReturnType<typeof setInterval> | undefined;
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error('Operation time budget exceeded')),
    4 * 60 * 60 * 1000,
  );
  try {
    const [lease] =
      await session`select pg_try_advisory_lock(hashtextextended(${id},${spec.lock})) as locked`;
    if (!lease.locked) return;
    locked = true;
    let checking = false;
    timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const [row] =
          await sqlClient`select state from ${sqlClient(spec.table)} where id=${id}`;
        if (!row || row.state === 'canceled' || row.state === 'queued')
          controller.abort(new Error('Operation canceled'));
      } catch {
        controller.abort(new Error('Operation state unavailable'));
      } finally {
        checking = false;
      }
    }, 500);
    return await withOperation({ kind, id, signal: controller.signal }, work);
  } finally {
    if (timer) clearInterval(timer);
    clearTimeout(deadline);
    if (locked)
      await session`select pg_advisory_unlock(hashtextextended(${id},${spec.lock}))`;
    session.release();
  }
}

/** Requeue only abandoned processing records. Active workers hold the same lease. */
export async function recoverInterrupted(
  kinds: readonly (keyof typeof jobKinds)[] = [
    'interpret',
    'chronicle',
    'research',
  ],
) {
  let recovered = 0;
  for (const kind of kinds) {
    const spec = jobKinds[kind];
    const rows =
      await sqlClient`select id from ${sqlClient(spec.table)} where state='processing' limit 50`;
    for (const row of rows)
      await sqlClient.begin(async (tx) => {
        // postgres.js TransactionSql omits the callable signatures from Sql.
        const query = tx as unknown as typeof sqlClient;
        const [lock] =
          await query`select pg_try_advisory_xact_lock(hashtextextended(${row.id},${spec.lock})) as locked`;
        if (!lock.locked) return;
        if ('legacyLock' in spec) {
          const [legacy] =
            await query`select pg_try_advisory_xact_lock(hashtextextended(${row.id},${spec.legacyLock})) as locked`;
          if (!legacy.locked) return;
        }
        const claimed =
          await query`update ${query(spec.table)} set state='queued', updated_at=now() where id=${row.id} and state='processing' returning id`;
        if (!claimed.length) return;
        if (kind === 'translation')
          await query`update transcript_translations set generation=generation+1 where id=${row.id}`;
        if (kind === 'research')
          await query`update research_outbox set generation=generation+1 where id=${row.id}`;
        if (kind === 'chronicle') {
          await query`update push_batches set generation=generation+1 where id=${row.id}`;
          await query`update chronicler_outbox set generation=generation+1 where id=${row.id}`;
        }
        if (kind === 'summary')
          await query`update meeting_summaries set generation=generation+1 where id=${row.id}`;
        await query`update ${query(spec.outbox)} set dispatched_at=null where id=${row.id}`;
        recovered++;
      });
  }
  return recovered;
}
