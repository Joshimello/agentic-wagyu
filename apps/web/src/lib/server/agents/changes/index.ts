import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, sqlClient } from '../../db/client';
import { comparisonJobs, changeProposals } from '../../db/schema';
import { getComparison } from '../../services/changes';
import { changesPromptVersion } from '../../contracts/changes';
import { watchJob } from '../../jobs/control';
import { withOperation } from '../../jobs/operation';
import { compareMeetings } from './model';

export async function compare(
  id: string,
  generation: number,
  options: Parameters<typeof compareMeetings>[1] = {},
) {
  const session = await sqlClient.reserve();
  let locked = false;
  const control = watchJob(
    async () => {
      const { job } = await getComparison(id);
      return (
        job.generation === generation &&
        ['queued', 'processing', 'failed'].includes(job.state)
      );
    },
    options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(12 * 60000)])
      : AbortSignal.timeout(12 * 60000),
  );
  try {
    const [lock] =
      await session`select pg_try_advisory_lock(hashtextextended(${id},72421)) as locked`;
    if (!lock.locked) throw new Error('Comparison is already leased');
    locked = true;
    const { job } = await getComparison(id);
    if (
      job.generation !== generation ||
      ['completed', 'canceled'].includes(job.state)
    )
      return;
    const [claimed] = await db
      .update(comparisonJobs)
      .set({
        state: 'processing',
        attempts: sql`${comparisonJobs.attempts}+1`,
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(comparisonJobs.id, id),
          eq(comparisonJobs.generation, generation),
          inArray(comparisonJobs.state, ['queued', 'failed', 'processing']),
        ),
      )
      .returning();
    if (!claimed) return;
    const active = () =>
      and(
        eq(comparisonJobs.id, id),
        eq(comparisonJobs.generation, generation),
        eq(comparisonJobs.state, 'processing'),
        eq(comparisonJobs.attempts, claimed.attempts),
      );
    try {
      const output = await withOperation(
        { kind: 'comparison', id, signal: control.signal },
        () =>
          compareMeetings(job.scope, {
            ...options,
            signal: control.signal,
            progress: async (progress) => {
              await control.assertActive();
              await db
                .update(comparisonJobs)
                .set({ progress, updatedAt: new Date() })
                .where(active());
              await options.progress?.(progress);
            },
          }),
      );
      await control.assertActive();
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(comparisonJobs)
          .where(eq(comparisonJobs.id, id))
          .for('update');
        if (
          current.state !== 'processing' ||
          current.generation !== generation ||
          current.attempts !== claimed.attempts
        )
          return;
        if (output.result.proposals.length)
          await tx.insert(changeProposals).values(
            output.result.proposals.map((proposal) => ({
              id: crypto.randomUUID(),
              comparisonId: id,
              proposal,
            })),
          );
        await tx
          .update(comparisonJobs)
          .set({
            state: 'completed',
            progress: 'Ready for review',
            warnings: output.result.warnings,
            model: output.model,
            promptVersion: changesPromptVersion,
            updatedAt: new Date(),
          })
          .where(active());
      });
    } catch (error) {
      const { job: current } = await getComparison(id);
      if (current.state === 'canceled' || current.generation !== generation)
        return;
      await db
        .update(comparisonJobs)
        .set({
          state: 'failed',
          progress: 'No proposals published',
          error:
            'Comparison could not finish valid supported proposals. Retry preserves the selected evidence and approved baseline.',
          updatedAt: new Date(),
        })
        .where(active());
      throw error;
    }
  } finally {
    control.stop();
    if (locked)
      await session`select pg_advisory_unlock(hashtextextended(${id},72421))`;
    session.release();
  }
}
