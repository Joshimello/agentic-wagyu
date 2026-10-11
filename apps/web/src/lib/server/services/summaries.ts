import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { revisions, summaryJobs, summaryOutbox, uploads } from '../db/schema';
import { id, type Stage } from '../contracts';
import {
  hasMeetingSpeech,
  summaryPromptVersion,
  type SummaryStatus,
} from '../contracts/summaries';

export const summaryInput = z.object({ revisionId: id }).strict();
export async function enqueueSummary(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  stage: Stage,
) {
  if (!hasMeetingSpeech(stage)) return;
  const [job] = await tx
    .insert(summaryJobs)
    .values({
      id: crypto.randomUUID(),
      revisionId: stage.id,
      promptVersion: summaryPromptVersion,
    })
    .onConflictDoNothing()
    .returning();
  if (job) await tx.insert(summaryOutbox).values({ id: job.id });
}
function status(row: typeof summaryJobs.$inferSelect): SummaryStatus {
  return {
    id: row.id,
    revisionId: row.revisionId,
    state: row.state,
    progressPercent: row.progressPercent,
    generation: row.generation,
    summary: row.state === 'ready' ? row.summary : null,
    error: row.error,
  };
}
export async function getSummary(
  uploadId: string,
  revisionId: string,
): Promise<SummaryStatus> {
  const [revision] = await db
    .select({ id: revisions.id })
    .from(revisions)
    .where(
      and(
        eq(revisions.id, id.parse(revisionId)),
        eq(revisions.uploadId, id.parse(uploadId)),
      ),
    );
  if (!revision) throw new Error('Revision not found for this source');
  const [row] = await db
    .select()
    .from(summaryJobs)
    .where(
      and(
        eq(summaryJobs.revisionId, revisionId),
        eq(summaryJobs.promptVersion, summaryPromptVersion),
      ),
    );
  return row
    ? status(row)
    : {
        id: null,
        revisionId,
        state: 'not_requested',
        progressPercent: 0,
        generation: 0,
        summary: null,
        error: null,
      };
}
export async function requestSummary(
  uploadId: string,
  value: unknown,
): Promise<SummaryStatus> {
  const { revisionId } = summaryInput.parse(value);
  return db.transaction(async (tx) => {
    const [upload] = await tx
      .select()
      .from(uploads)
      .where(eq(uploads.id, id.parse(uploadId)))
      .for('update');
    if (!upload || upload.deletedAt) throw new Error('Source is unavailable');
    const [revision] = await tx
      .select()
      .from(revisions)
      .where(
        and(eq(revisions.id, revisionId), eq(revisions.uploadId, uploadId)),
      );
    if (!revision || !hasMeetingSpeech(revision.manifest))
      throw new Error('A reviewed meeting transcript is required');
    const [cached] = await tx
      .select()
      .from(summaryJobs)
      .where(
        and(
          eq(summaryJobs.revisionId, revisionId),
          eq(summaryJobs.promptVersion, summaryPromptVersion),
        ),
      )
      .for('update');
    if (cached && !['failed', 'canceled'].includes(cached.state))
      return status(cached);
    const [job] = cached
      ? await tx
          .update(summaryJobs)
          .set({
            state: 'queued',
            error: null,
            generation: sql`${summaryJobs.generation}+1`,
            updatedAt: new Date(),
          })
          .where(eq(summaryJobs.id, cached.id))
          .returning()
      : await tx
          .insert(summaryJobs)
          .values({
            id: crypto.randomUUID(),
            revisionId,
            promptVersion: summaryPromptVersion,
          })
          .returning();
    await tx
      .insert(summaryOutbox)
      .values({ id: job.id })
      .onConflictDoUpdate({
        target: summaryOutbox.id,
        set: { dispatchedAt: null },
      });
    return status(job);
  });
}
export async function cancelSummary(
  uploadId: string,
  summaryId: string,
  expectedGeneration?: number,
): Promise<SummaryStatus> {
  return db.transaction(async (tx) => {
    const [upload] = await tx
      .select()
      .from(uploads)
      .where(eq(uploads.id, id.parse(uploadId)))
      .for('update');
    if (!upload) throw new Error('Source not found');
    const [owned] = await tx
      .select({ id: summaryJobs.id })
      .from(summaryJobs)
      .innerJoin(revisions, eq(summaryJobs.revisionId, revisions.id))
      .where(
        and(
          eq(summaryJobs.id, id.parse(summaryId)),
          eq(revisions.uploadId, uploadId),
        ),
      );
    if (!owned) throw new Error('Summary not found for this source');
    const [job] = await tx
      .select()
      .from(summaryJobs)
      .where(eq(summaryJobs.id, summaryId))
      .for('update');
    if (
      expectedGeneration !== undefined &&
      expectedGeneration !== job.generation
    )
      throw new Error(
        'This summary attempt changed. Refresh its status before canceling.',
      );
    if (!['queued', 'processing'].includes(job.state)) return status(job);
    const [canceled] = await tx
      .update(summaryJobs)
      .set({
        state: 'canceled',
        generation: sql`${summaryJobs.generation}+1`,
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(summaryJobs.id, summaryId),
          inArray(summaryJobs.state, ['queued', 'processing']),
        ),
      )
      .returning();
    await tx
      .update(summaryOutbox)
      .set({ dispatchedAt: new Date() })
      .where(eq(summaryOutbox.id, summaryId));
    return status(canceled);
  });
}
