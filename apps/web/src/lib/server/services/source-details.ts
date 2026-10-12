import { desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { uploads, revisions, runs } from '../db/schema';
import { id, validateStage, type Stage } from '../contracts';
import { sourceProjectName, sourceProjectNames } from '../../source-organization';
import { processingRetryPending } from './processing-retries';

const fields = z.object({
  label: z.string().trim().min(1).max(500),
  sourceTime: z.string().datetime().nullable(),
  projectName: z.string().trim().max(500),
}).strict();
export const sourceDetailsInput = fields.extend({
  baseRevisionId: id.nullable(),
  previous: fields.extend({ label: z.string().max(500) }),
}).strict();

export async function listSourceProjectNames() {
  const rows = await db.select({
    metadata: sql<Stage['metadata']>`coalesce(${revisions.manifest}->'metadata', ${uploads.metadata})`,
  }).from(uploads)
    .leftJoin(revisions, eq(revisions.id, uploads.currentRevisionId))
    .where(isNull(uploads.deletedAt));
  return sourceProjectNames(rows.map((row) => sourceProjectName(row.metadata)));
}

export async function updateSourceDetails(uploadId: string, value: unknown) {
  id.parse(uploadId);
  const input = sourceDetailsInput.parse(value);
  return db.transaction(async (tx) => {
    const [upload] = await tx.select().from(uploads).where(eq(uploads.id, uploadId)).for('update');
    if (!upload || upload.deletedAt) throw new Error('Source is unavailable');
    const [run] = await tx.select().from(runs).where(eq(runs.uploadId, uploadId))
      .orderBy(desc(runs.createdAt)).limit(1).for('update');
    if (run && (['queued', 'processing'].includes(run.state) || await processingRetryPending(run.id, run.state, tx)))
      throw new Error('Wait for processing to finish before editing source details');
    const [base] = upload.currentRevisionId
      ? await tx.select().from(revisions).where(eq(revisions.id, upload.currentRevisionId))
      : [];
    if (upload.currentRevisionId && (!base || base.uploadId !== upload.id))
      throw new Error('Source revision is unavailable');
    const current = base?.manifest.metadata ?? upload.metadata;
    if (upload.currentRevisionId !== input.baseRevisionId ||
        current.label !== input.previous.label ||
        current.sourceTime !== input.previous.sourceTime ||
        sourceProjectName(current) !== input.previous.projectName)
      throw new Error('Source details changed. Reload before saving your changes.');
    if (current.label === input.label && current.sourceTime === input.sourceTime &&
        sourceProjectName(current) === input.projectName) return upload.id;
    const metadata: Stage['metadata'] = {
      ...current,
      label: input.label,
      sourceTime: input.sourceTime,
      sourceTimeOrigin: input.sourceTime === current.sourceTime
        ? current.sourceTimeOrigin : input.sourceTime ? 'user' : 'unknown',
      groupHint: input.projectName,
    };
    let revisionId = upload.currentRevisionId;
    if (base) {
      const stage = structuredClone(base.manifest);
      stage.id = crypto.randomUUID();
      stage.parentRevisionId = base.id;
      stage.createdAt = new Date().toISOString();
      stage.metadata = metadata;
      validateStage(stage);
      await tx.insert(revisions).values({ id: stage.id, uploadId, parentRevisionId: base.id, manifest: stage });
      revisionId = stage.id;
    }
    await tx.update(uploads).set({ metadata, currentRevisionId: revisionId }).where(eq(uploads.id, uploadId));
    return upload.id;
  });
}
