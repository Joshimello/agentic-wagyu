import { PgBoss } from 'pg-boss';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { translationJobs, translationOutbox } from '../db/schema';
import { config } from '../config';
import { stableId } from '../contracts/memory';

export const translationQueue = 'translate-transcript';

export async function startTranslationQueue() {
  const boss = new PgBoss(config.databaseUrl);
  boss.on('error', () =>
    console.error(
      'Translation queue connection error; pending jobs remain durable',
    ),
  );
  await boss.start();
  const options = {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 7200,
  };
  await boss.createQueue(translationQueue, options);
  await boss.updateQueue(translationQueue, options);
  return boss;
}

export async function dispatchTranslations(boss: PgBoss) {
  const pending = await db
    .select()
    .from(translationOutbox)
    .innerJoin(translationJobs, eq(translationOutbox.id, translationJobs.id))
    .where(isNull(translationOutbox.dispatchedAt))
    .limit(50);
  for (const row of pending) {
    const job = row.transcript_translations;
    await boss.send(
      translationQueue,
      { translationId: job.id },
      {
        id: stableId(job.id, 'translation-queue', String(job.generation)),
      },
    );
    // Recheck generation so a simultaneous manual retry keeps its new outbox entry.
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(translationJobs)
        .where(eq(translationJobs.id, job.id))
        .for('update');
      if (current?.generation !== job.generation) return;
      await tx
        .update(translationOutbox)
        .set({ dispatchedAt: new Date() })
        .where(
          and(
            eq(translationOutbox.id, job.id),
            isNull(translationOutbox.dispatchedAt),
          ),
        );
    });
  }
}

/** Process death can exhaust queue retries before the handler updates its status. */
export async function reconcileTranslations(boss: PgBoss) {
  const staleBefore = new Date(Date.now() - 30000);
  const stale = await db
    .select()
    .from(translationJobs)
    .where(
      and(
        inArray(translationJobs.state, ['queued', 'processing']),
        lt(translationJobs.updatedAt, staleBefore),
      ),
    )
    .limit(50);
  for (const row of stale) {
    const queueJob = await boss.getJobById(
      translationQueue,
      stableId(row.id, 'translation-queue', String(row.generation)),
    );
    if (
      queueJob &&
      !['failed', 'cancelled', 'completed'].includes(queueJob.state)
    )
      continue;
    if (!queueJob) {
      const [outbox] = await db
        .select()
        .from(translationOutbox)
        .where(eq(translationOutbox.id, row.id));
      if (!outbox?.dispatchedAt) continue;
    }
    await db
      .update(translationJobs)
      .set({
        state: 'failed',
        error:
          'Translation worker stopped before completing. Saved progress is retained; try again.',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(translationJobs.id, row.id),
          eq(translationJobs.generation, row.generation),
          lt(translationJobs.updatedAt, staleBefore),
          inArray(translationJobs.state, ['queued', 'processing']),
        ),
      );
  }
}
