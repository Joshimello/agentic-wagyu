import { eq, sql, and, ne } from 'drizzle-orm';
import { db, sqlClient } from '../../db/client';
import { currentOperation, withOperation } from '../../jobs/operation';
import { pushBatches, revisions } from '../../db/schema';
import {
  watchJob,
  boundedProgress,
  type JobProgress,
} from '../../jobs/control';
import { validateStage } from '../../contracts';
import { memorySnapshot } from '../../services/memory';
import { buildMemoryPlan } from './model';
import { buildOrganizationPlan } from './organization/model';
import { publishMemory, StaleMemory } from './publication';
export async function chronicle(
  pushId: string,
  options: {
    buildPlan?: typeof buildMemoryPlan;
    signal?: AbortSignal;
    generation?: number;
  } = {},
) {
  return withOperation(
    { kind: 'chronicle', id: pushId, signal: options.signal },
    () =>
      chronicleLeased(pushId, {
        ...options,
        signal: currentOperation()?.signal,
      }),
  );
}
async function chronicleLeased(
  pushId: string,
  options: {
    buildPlan?: typeof buildMemoryPlan;
    signal?: AbortSignal;
    generation?: number;
  },
) {
  const connection = await sqlClient.reserve();
  let locked = false;
  try {
    const [lock] =
      await connection`select pg_try_advisory_lock(hashtextextended(${pushId}, 72419)) as locked`;
    locked = !!lock.locked;
  } catch (error) {
    connection.release();
    throw error;
  }
  if (!locked) {
    connection.release();
    throw new Error('Push is already processing');
  }
  let control: ReturnType<typeof watchJob> | undefined;
  try {
    let [batch] = await db
      .select()
      .from(pushBatches)
      .where(eq(pushBatches.id, pushId));
    if (
      !batch ||
      ['committed', 'canceled'].includes(batch.state) ||
      (options.generation !== undefined &&
        options.generation !== batch.generation)
    )
      return batch;
    const guard = and(
      eq(pushBatches.id, pushId),
      eq(pushBatches.generation, batch.generation),
      ne(pushBatches.state, 'committed'),
      ne(pushBatches.state, 'canceled'),
    );
    control = watchJob(async () => {
      const [current] = await db
        .select()
        .from(pushBatches)
        .where(eq(pushBatches.id, pushId));
      return (
        !!current &&
        current.generation === batch.generation &&
        ['queued', 'processing', 'failed'].includes(current.state)
      );
    }, options.signal);
    await db
      .update(pushBatches)
      .set({
        state: 'processing',
        attempts: sql`${pushBatches.attempts}+1`,
        progress: 'Loading pinned evidence',
        error: null,
        updatedAt: new Date(),
      })
      .where(guard);
    const progress: JobProgress = async (text, percent) => {
      await control!.assertActive();
      await db
        .update(pushBatches)
        .set({
          progress: text,
          ...(percent === undefined
            ? {}
            : {
                progressPercent: sql`greatest(${pushBatches.progressPercent}, ${boundedProgress(percent)})`,
              }),
          updatedAt: new Date(),
        })
        .where(guard);
    };

    try {
      await control.assertActive();
      const stages = [];
      for (const item of batch.input.items) {
        const [r] = await db
          .select()
          .from(revisions)
          .where(eq(revisions.id, item.revisionId));
        if (!r || r.uploadId !== item.uploadId)
          throw new Error('Pinned evidence is missing');
        stages.push(validateStage(r.manifest));
      }
      await progress('Pinned evidence loaded', 5);
      for (let attempt = 0; attempt < 3; attempt++) {
        await control.assertActive();
        const snapshot = await memorySnapshot();
        const plan =
          batch.plan?.baseVersion === snapshot.version
            ? batch.plan
            : await (
                options.buildPlan ??
                (batch.input.workflow === 'summary'
                  ? buildOrganizationPlan
                  : buildMemoryPlan)
              )(pushId, batch.input, stages, snapshot, {
                progress,
                signal: control.signal,
                generation: batch.generation,
              });
        await db
          .update(pushBatches)
          .set({ baseVersion: snapshot.version, plan, updatedAt: new Date() })
          .where(guard);
        await progress('Validating and publishing memory', 95);
        try {
          return await publishMemory(pushId, plan, batch.generation);
        } catch (error) {
          if (!(error instanceof StaleMemory)) throw error;
          batch = { ...batch, plan: null };
          await progress('Memory changed; refreshing reconciliation');
        }
      }
      throw new Error('Memory changed repeatedly; retry this pinned push');
    } catch (error) {
      const [current] = await db
        .select()
        .from(pushBatches)
        .where(eq(pushBatches.id, pushId));
      if (
        current?.state === 'canceled' ||
        current?.generation !== batch.generation
      )
        return current;
      console.error('Chronicler push failed', {
        errorType: error instanceof Error ? error.name : 'Unknown',
      });
      await db
        .update(pushBatches)
        .set({
          state: 'failed',
          error:
            'Memory processing failed. Source selection is preserved; retry this push.',
          progress: 'No memory changes were published',
          updatedAt: new Date(),
        })
        .where(guard);
      const [latest] = await db
        .select()
        .from(pushBatches)
        .where(eq(pushBatches.id, pushId));
      if (
        latest?.state === 'canceled' ||
        latest?.generation !== batch.generation
      )
        return latest;
      throw error;
    }
  } finally {
    control?.stop();
    try {
      await connection`select pg_advisory_unlock(hashtextextended(${pushId}, 72419))`;
    } finally {
      connection.release();
    }
  }
}
