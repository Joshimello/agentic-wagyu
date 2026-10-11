import type { PgBoss } from 'pg-boss';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { summaryJobs, summaryOutbox } from '../db/schema';
import { stableId } from '../contracts/memory';
export const summaryQueue = 'summarize-meeting';
export async function setupSummaryQueue(boss: PgBoss) {
  const options = {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 7200,
  };
  await boss.createQueue(summaryQueue, options);
  await boss.updateQueue(summaryQueue, options);
}
export async function dispatchSummaries(boss: PgBoss) {
  const pending = await db
    .select()
    .from(summaryOutbox)
    .innerJoin(summaryJobs, eq(summaryOutbox.id, summaryJobs.id))
    .where(
      and(isNull(summaryOutbox.dispatchedAt), eq(summaryJobs.state, 'queued')),
    )
    .limit(50);
  for (const row of pending) {
    const job = row.meeting_summaries;
    await boss.send(
      summaryQueue,
      { summaryId: job.id, generation: job.generation },
      { id: stableId(job.id, 'summary-queue', String(job.generation)) },
    );
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(summaryJobs)
        .where(eq(summaryJobs.id, job.id))
        .for('update');
      if (current?.generation !== job.generation || current.state !== 'queued')
        return;
      await tx
        .update(summaryOutbox)
        .set({ dispatchedAt: new Date() })
        .where(
          and(eq(summaryOutbox.id, job.id), isNull(summaryOutbox.dispatchedAt)),
        );
    });
  }
}
export async function reconcileSummaries(boss: PgBoss) {
  const before = new Date(Date.now() - 30000);
  const stale = await db
    .select()
    .from(summaryJobs)
    .where(
      and(
        inArray(summaryJobs.state, ['queued', 'processing']),
        lt(summaryJobs.updatedAt, before),
      ),
    )
    .limit(50);
  for (const row of stale) {
    const job = await boss.getJobById(
      summaryQueue,
      stableId(row.id, 'summary-queue', String(row.generation)),
    );
    if (job && !['failed', 'cancelled', 'completed'].includes(job.state))
      continue;
    const [outbox] = await db
      .select()
      .from(summaryOutbox)
      .where(eq(summaryOutbox.id, row.id));
    if (!job && !outbox?.dispatchedAt) continue;
    await db
      .update(summaryJobs)
      .set({
        state: 'failed',
        error:
          'Summary processing was interrupted. Completed reading is saved.',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(summaryJobs.id, row.id),
          eq(summaryJobs.generation, row.generation),
          inArray(summaryJobs.state, ['queued', 'processing']),
          lt(summaryJobs.updatedAt, before),
        ),
      );
  }
}
