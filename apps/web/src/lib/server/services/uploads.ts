import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  assets,
  uploads,
  runs,
  outbox,
  revisions,
  memoryCommits,
  uploadSessions,
} from '../db/schema';
import { storeBytes } from '../storage';
import { metadata } from '../contracts';
import { config } from '../config';
import { memoryRelationship } from './memory';
import { processingRetryPending } from './processing-retries';

type UploadFields = {
  uploader?: string;
  label?: string;
  sourceTime?: string;
  groupId?: string;
  groupHint?: string;
};
export async function acceptUpload(file: File, fields: UploadFields) {
  return (await acceptUploadBatch([file], fields))[0];
}
export async function acceptUploadBatch(
  files: File[],
  fields: UploadFields,
  options: { signal?: AbortSignal; sessionId?: string } = {},
) {
  options.signal?.throwIfAborted();
  if (!files.length || files.length > 20)
    throw new Error('Choose between 1 and 20 files');
  if (
    files.some((file) => file.size === 0 || file.size > config.maxUploadBytes)
  )
    throw new Error('Each file must be between 1 byte and 512 MiB');
  const groupId =
    fields.groupId ??
    (files.length > 1 || fields.groupHint?.trim()
      ? crypto.randomUUID()
      : undefined);
  const prepared: {
    filename: string;
    meta: ReturnType<typeof metadata.parse>;
    stored: Awaited<ReturnType<typeof storeBytes>>;
    mime: string;
  }[] = [];
  for (const file of files) {
    options.signal?.throwIfAborted();
    const filename = file.name.replace(/[\x00-\x1f]/g, '').slice(0, 255);
    const meta = metadata.parse({
      uploader: fields.uploader?.trim() || 'local',
      uploadedAt: new Date().toISOString(),
      sourceTime: fields.sourceTime || null,
      label: fields.label || filename,
      sourceTimeOrigin: fields.sourceTime ? 'user' : 'unknown',
      ...(groupId
        ? {
            groupId,
            groupHint: fields.groupHint?.trim() || 'Uploaded together',
          }
        : {}),
    });
    const stored = await storeBytes(new Uint8Array(await file.arrayBuffer()));
    options.signal?.throwIfAborted();
    prepared.push({
      filename,
      meta,
      stored,
      mime: file.type || 'application/octet-stream',
    });
  }
  return db.transaction(async (tx) => {
    options.signal?.throwIfAborted();
    if (options.sessionId) {
      const [session] = await tx
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, options.sessionId))
        .for('update');
      if (!session || session.state !== 'uploading')
        throw new Error('Upload was canceled or already accepted');
    }
    const accepted = [];
    for (const file of prepared) {
      const uploadId = crypto.randomUUID(),
        runId = crypto.randomUUID();
      await tx
        .insert(assets)
        .values({ id: crypto.randomUUID(), ...file.stored, mime: file.mime })
        .onConflictDoNothing({ target: assets.sha256 });
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.sha256, file.stored.sha256));
      await tx.insert(uploads).values({
        id: uploadId,
        assetId: asset.id,
        filename: file.filename,
        metadata: file.meta,
      });
      await tx.insert(runs).values({ id: runId, uploadId });
      await tx.insert(outbox).values({ id: runId });
      accepted.push({ uploadId, runId });
    }
    options.signal?.throwIfAborted();
    if (options.sessionId)
      await tx
        .update(uploadSessions)
        .set({ state: 'accepted', accepted, updatedAt: new Date() })
        .where(eq(uploadSessions.id, options.sessionId));
    return accepted;
  });
}
export async function listUploads() {
  const rows = await db
    .select({
      uploads,
      assets,
      currentMetadata: sql<
        typeof uploads.$inferSelect.metadata | null
      >`${revisions.manifest}->'metadata'`,
    })
    .from(uploads)
    .innerJoin(assets, eq(uploads.assetId, assets.id))
    .leftJoin(revisions, eq(revisions.id, uploads.currentRevisionId))
    .where(isNull(uploads.deletedAt))
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
        metadata: row.currentMetadata ?? row.uploads.metadata,
        bytes: row.assets.bytes,
        mime: row.assets.mime,
        run: run
          ? {
              ...run,
              retryPending: await processingRetryPending(run.id, run.state),
            }
          : run,
        memory: await memoryRelationship(
          row.uploads.id,
          row.uploads.currentRevisionId,
        ),
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
  return {
    upload: {
      ...row.uploads,
      metadata:
        history.find(
          (revision) => revision.id === row.uploads.currentRevisionId,
        )?.manifest.metadata ?? row.uploads.metadata,
    },
    asset: row.assets,
    run: {
      ...run,
      retryPending: run
        ? await processingRetryPending(run.id, run.state)
        : false,
    },
    revisions: history,
    memory: await memoryRelationship(
      row.uploads.id,
      row.uploads.currentRevisionId,
    ),
  };
}
export async function retryUpload(
  id: string,
  inputRevisionId?: string,
  mode?: 'full' | 'context' | 'speakers',
) {
  const reviewMode = mode ?? (inputRevisionId ? 'context' : 'full');
  if (reviewMode !== 'full' && !inputRevisionId)
    throw new Error('Review mode requires a pinned input revision');
  if (reviewMode === 'full' && inputRevisionId)
    throw new Error('Full reprocessing cannot use an input revision');
  return db.transaction(async (tx) => {
    // Serialize user actions before reading the latest run.
    const [upload] = await tx
      .select()
      .from(uploads)
      .where(eq(uploads.id, id))
      .for('update');
    if (!upload || upload.deletedAt) throw new Error('Upload not found');
    if (
      reviewMode === 'speakers' &&
      !/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(upload.filename)
    )
      throw new Error('Speaker name review requires a recording');
    if (inputRevisionId && upload.currentRevisionId !== inputRevisionId)
      throw new Error(
        'Staging changed. Reload before revisiting descriptions.',
      );
    if (
      inputRevisionId &&
      !/\.(mp4|mov|mkv|webm|m4v|avi|pptx|pdf|png|jpg|jpeg|webp|bmp|tif|tiff)$/i.test(
        upload.filename,
      )
    )
      throw new Error('Description review requires a recording or document');
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
    if (await processingRetryPending(latest.id, latest.state, tx))
      throw new Error(
        'An automatic retry is already queued. Completed work will be reused.',
      );
    const runId = crypto.randomUUID();
    await tx
      .insert(runs)
      .values({ id: runId, uploadId: id, inputRevisionId, reviewMode });
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

export async function cancelUploadRun(uploadId: string, runId: string) {
  const run = await db.transaction(async (tx) => {
    // Use the same upload-then-run lock order as publication and deletion.
    const [upload] = await tx
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .for('update');
    if (!upload) throw new Error('Upload not found');
    const [current] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.uploadId, uploadId)))
      .for('update');
    if (!current) throw new Error('Run not found for this upload');
    if (
      !['queued', 'processing'].includes(current.state) &&
      !(await processingRetryPending(current.id, current.state, tx))
    )
      return current;
    const [canceled] = await tx
      .update(runs)
      .set({
        state: 'canceled',
        progress: 'Canceled; completed work is saved',
        error: null,
        updatedAt: new Date(),
      })
      .where(and(eq(runs.id, runId), eq(runs.state, current.state)))
      .returning();
    await tx
      .update(outbox)
      .set({ dispatchedAt: new Date() })
      .where(eq(outbox.id, runId));
    return canceled;
  });
  if (run.state === 'canceled') {
    // A tombstone also stops a request that arrives after this endpoint returns.
    try {
      await fetch(`${config.mediaUrl}/jobs/${runId}/cancel`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      console.warn(
        'Media cancellation deferred; worker will retry cancellation',
      );
    }
  }
  return run;
}

export async function cancelUpload(uploadId: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.uploadId, uploadId))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  if (!run) throw new Error('Upload has no interpretation run');
  return cancelUploadRun(uploadId, run.id);
}
