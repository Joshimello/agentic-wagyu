import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  assets,
  uploads,
  runs,
  outbox,
  revisions,
  memoryCommits,
} from '../db/schema';
import { storeBytes } from '../storage';
import { metadata } from '../contracts';
import { config } from '../config';

export async function acceptUpload(
  file: File,
  fields: { uploader?: string; label?: string; sourceTime?: string },
) {
  if (file.size === 0 || file.size > config.maxUploadBytes)
    throw new Error('File must be between 1 byte and 512 MiB');
  const filename = file.name.replace(/[\x00-\x1f]/g, '').slice(0, 255);
  const meta = metadata.parse({
    uploader: fields.uploader?.trim() || 'local',
    uploadedAt: new Date().toISOString(),
    sourceTime: fields.sourceTime || null,
    label: fields.label || filename,
    sourceTimeOrigin: fields.sourceTime ? 'user' : 'unknown',
  });
  const stored = await storeBytes(new Uint8Array(await file.arrayBuffer()));
  const uploadId = crypto.randomUUID(),
    runId = crypto.randomUUID();
  return db.transaction(async (tx) => {
    await tx
      .insert(assets)
      .values({
        id: crypto.randomUUID(),
        ...stored,
        mime: file.type || 'application/octet-stream',
      })
      .onConflictDoNothing({ target: assets.sha256 });
    const [asset] = await tx
      .select()
      .from(assets)
      .where(eq(assets.sha256, stored.sha256));
    await tx
      .insert(uploads)
      .values({ id: uploadId, assetId: asset.id, filename, metadata: meta });
    await tx.insert(runs).values({ id: runId, uploadId });
    await tx.insert(outbox).values({ id: runId });
    return { uploadId, runId };
  });
}
export async function listUploads() {
  const rows = await db
    .select()
    .from(uploads)
    .innerJoin(assets, eq(uploads.assetId, assets.id))
    .orderBy(desc(uploads.createdAt));
  return Promise.all(
    rows.map(async (row) => {
      const [run] = await db
        .select()
        .from(runs)
        .where(eq(runs.uploadId, row.uploads.id))
        .orderBy(desc(runs.createdAt))
        .limit(1);
      return {
        ...row.uploads,
        bytes: row.assets.bytes,
        mime: row.assets.mime,
        run,
      };
    }),
  );
}
export async function getUpload(id: string) {
  const [row] = await db
    .select()
    .from(uploads)
    .innerJoin(assets, eq(uploads.assetId, assets.id))
    .where(eq(uploads.id, id));
  if (!row) throw new Error('Upload not found');
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.uploadId, id))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  const history = await db
    .select()
    .from(revisions)
    .where(eq(revisions.uploadId, id))
    .orderBy(desc(revisions.createdAt));
  return { upload: row.uploads, asset: row.assets, run, revisions: history };
}
export async function retryUpload(id: string, inputRevisionId?: string) {
  return db.transaction(async (tx) => {
    // Serialize user actions before reading the latest run.
    const [upload] = await tx
      .select()
      .from(uploads)
      .where(eq(uploads.id, id))
      .for('update');
    if (!upload) throw new Error('Upload not found');
    if (inputRevisionId && upload.currentRevisionId !== inputRevisionId)
      throw new Error(
        'Staging changed. Reload before revisiting visual context.',
      );
    if (
      inputRevisionId &&
      !/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(upload.filename)
    )
      throw new Error('Visual context review requires a recording');
    const [latest] = await tx
      .select()
      .from(runs)
      .where(eq(runs.uploadId, id))
      .orderBy(desc(runs.createdAt))
      .limit(1);
    if (
      !latest ||
      !['failed', 'canceled', 'ready', 'ready_with_warnings'].includes(
        latest.state,
      )
    )
      throw new Error('Current interpretation must finish before retrying');
    const runId = crypto.randomUUID();
    await tx.insert(runs).values({ id: runId, uploadId: id, inputRevisionId });
    await tx.insert(outbox).values({ id: runId });
    return runId;
  });
}
export async function memoryCount() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memoryCommits);
  return row.count;
}
