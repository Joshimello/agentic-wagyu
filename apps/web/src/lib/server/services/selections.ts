import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { stagingSelections, revisions, uploads } from '../db/schema';
import { id, validateStage } from '../contracts';
const input = z
  .object({
    uploadId: id,
    revisionId: id,
    acceptPartial: z.boolean().default(false),
  })
  .strict();
export async function listSelections() {
  const rows = await db
    .select()
    .from(stagingSelections)
    .innerJoin(revisions, eq(stagingSelections.revisionId, revisions.id))
    .innerJoin(uploads, eq(stagingSelections.uploadId, uploads.id));
  return rows.map((row) => {
    const stage = validateStage(row.staging_revisions.manifest);
    return {
      ...row.staging_selections,
      filename: row.uploads.filename,
      metadata: stage.metadata,
      currentRevisionId: row.uploads.currentRevisionId,
      stale: stage.id !== row.uploads.currentRevisionId,
      complete: stage.coverage.complete,
      warnings: stage.coverage.warnings,
      readyForPush:
        stage.coverage.complete || row.staging_selections.acceptPartial,
    };
  });
}
export async function selectRevision(value: unknown) {
  const item = input.parse(value);
  await db.transaction(async (tx) => {
    const [upload] = await tx
      .select()
      .from(uploads)
      .where(eq(uploads.id, item.uploadId))
      .for('update');
    const [revision] = await tx
      .select()
      .from(revisions)
      .where(eq(revisions.id, item.revisionId));
    if (!upload || !revision || revision.uploadId !== upload.id)
      throw new Error('Revision does not belong to this source');
    validateStage(revision.manifest);
    const [existing] = await tx
      .select()
      .from(stagingSelections)
      .where(eq(stagingSelections.uploadId, item.uploadId));
    // Acceptance can change for an already pinned older revision. New selections must explicitly capture the current revision.
    if (
      upload.currentRevisionId !== item.revisionId &&
      existing?.revisionId !== item.revisionId
    )
      throw new Error(
        'Staging changed. Reload before selecting its current revision.',
      );
    await tx
      .insert(stagingSelections)
      .values(item)
      .onConflictDoUpdate({
        target: stagingSelections.uploadId,
        set: { revisionId: item.revisionId, acceptPartial: item.acceptPartial },
      });
  });
  return listSelections();
}
export async function removeSelection(uploadId: string) {
  await db
    .delete(stagingSelections)
    .where(eq(stagingSelections.uploadId, id.parse(uploadId)));
  return listSelections();
}
