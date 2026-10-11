import { and, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import {
  uploads,
  runs,
  stagingSelections,
  pushBatches,
  pushItems,
  outbox,
  translationOutbox,
  chroniclerOutbox,
  summaryJobs,
  summaryOutbox,
} from '../db/schema';
import { id } from '../contracts';
import { cancelUploadRun } from './uploads';
import { cancelTranslation } from './translations';
import { cancelPush } from './pushes';

export const removalInput = z
  .object({
    uploadIds: z
      .array(id)
      .min(1)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Choose each source only once',
      ),
  })
  .strict();

export async function removeUploads(value: unknown) {
  const { uploadIds } = removalInput.parse(value);
  const affected = await db.transaction(async (tx) => {
    // Serialize removal with memory publication; retained evidence keeps old citations valid.
    await tx.execute(sql`select pg_advisory_xact_lock(736501)`);
    const sources = await tx
      .select()
      .from(uploads)
      .where(inArray(uploads.id, uploadIds))
      .orderBy(uploads.id)
      .for('update');
    if (sources.length !== uploadIds.length)
      throw new Error('One or more selected sources no longer exist');
    const pendingRuns = await tx
      .update(runs)
      .set({
        state: 'canceled',
        progress: 'Removed from Staging',
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(runs.uploadId, uploadIds),
          inArray(runs.state, ['queued', 'processing']),
        ),
      )
      .returning({ id: runs.id, uploadId: runs.uploadId });
    const selectedUploadIds = sources.map((source) => source.id);
    const pendingSummaries = await tx.execute<{ id: string }>(sql`
      update meeting_summaries as summary
      set state = 'canceled', generation = generation + 1, error = null, updated_at = now()
      from staging_revisions as revision
      where summary.revision_id = revision.id and revision.upload_id in (${sql.join(
        selectedUploadIds.map((source) => sql`${source}::uuid`),
        sql`, `,
      )})
        and summary.state in ('queued', 'processing')
      returning summary.id
    `);
    if (pendingSummaries.length)
      await tx
        .update(summaryOutbox)
        .set({ dispatchedAt: new Date() })
        .where(
          inArray(
            summaryOutbox.id,
            [...pendingSummaries].map((job) => job.id),
          ),
        );
    const pendingTranslations = await tx.execute<{
      id: string;
      uploadId: string;
    }>(sql`
      update transcript_translations as translation
      set state = 'canceled', generation = generation + 1, error = null, updated_at = now()
      from staging_revisions as revision
      where translation.revision_id = revision.id
        and revision.upload_id in (${sql.join(
          selectedUploadIds.map((source) => sql`${source}::uuid`),
          sql`, `,
        )})
        and translation.state in ('queued', 'processing')
      returning translation.id, revision.upload_id as "uploadId"
    `);
    const items = await tx
      .select({ pushId: pushItems.pushId })
      .from(pushItems)
      .where(inArray(pushItems.uploadId, uploadIds));
    const pushIds = [...new Set(items.map((item) => item.pushId))];
    const pendingPushes = pushIds.length
      ? await tx
          .update(pushBatches)
          .set({
            state: 'canceled',
            generation: sql`${pushBatches.generation}+1`,
            progress: 'A selected source was removed from Staging',
            error: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(pushBatches.id, pushIds),
              inArray(pushBatches.state, ['queued', 'processing']),
            ),
          )
          .returning({ id: pushBatches.id })
      : [];
    if (pendingRuns.length)
      await tx
        .update(outbox)
        .set({ dispatchedAt: new Date() })
        .where(
          inArray(
            outbox.id,
            pendingRuns.map((run) => run.id),
          ),
        );
    if (pendingTranslations.length)
      await tx
        .update(translationOutbox)
        .set({ dispatchedAt: new Date() })
        .where(
          inArray(
            translationOutbox.id,
            [...pendingTranslations].map((job) => job.id),
          ),
        );
    if (pendingPushes.length)
      await tx
        .update(chroniclerOutbox)
        .set({ dispatchedAt: new Date() })
        .where(
          inArray(
            chroniclerOutbox.id,
            pendingPushes.map((push) => push.id),
          ),
        );
    await tx
      .delete(stagingSelections)
      .where(inArray(stagingSelections.uploadId, uploadIds));
    await tx
      .update(uploads)
      .set({ deletedAt: sql`coalesce(${uploads.deletedAt}, now())` })
      .where(inArray(uploads.id, uploadIds));
    return {
      pendingRuns,
      pendingTranslations: [...pendingTranslations],
      pendingPushes,
    };
  });
  // Stop live work after committing the cancellation fences, without holding database locks over HTTP.
  await Promise.allSettled([
    ...affected.pendingRuns.map((run) => cancelUploadRun(run.uploadId, run.id)),
    ...affected.pendingTranslations.map((job) =>
      cancelTranslation(job.uploadId, job.id),
    ),
    ...affected.pendingPushes.map((push) => cancelPush(push.id)),
  ]);
  return { removedIds: uploadIds };
}
