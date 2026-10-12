import { desc, eq } from 'drizzle-orm';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import { db, sqlClient } from '../db/client';
import { assets, uploads, runs } from '../db/schema';
import { config } from '../config';
import { assetPath } from '../storage';
import { asrSchema } from '../agents/interpreter/transcript';
import { processingRetryPending } from './processing-retries';
import {
  readProcessingEvents,
  describeProcessingFailure,
  redactDiagnostic,
} from '../agents/interpreter/diagnostics';

const liveSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  stage: z.string(),
  coveredMs: z.number().nonnegative(),
  startMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative().nullable(),
  generatedTokens: z.number().nonnegative(),
  updatedAt: z.string(),
});

async function savedWindows(uploadId: string, storageKey: string) {
  const directory = assetPath(`runs/${uploadId}/moss-windows-v2`);
  let files: string[];
  try {
    files = await readdir(directory);
  } catch {
    return [];
  }
  const windows = await Promise.all(
    files
      .filter((name) => /^part-1800000-\d+\.json$/.test(name))
      .slice(0, 8)
      .map(async (name) => {
        try {
          const file = Bun.file(`${directory}/${name}`);
          if (file.size > 4 * 1024 * 1024) return null;
          const checkpoint = await file.json();
          if (
            checkpoint.version !== 2 ||
            checkpoint.storageKey !== storageKey ||
            !Number.isSafeInteger(checkpoint.startMs) ||
            checkpoint.startMs < 0 ||
            !Number.isSafeInteger(checkpoint.durationMs) ||
            checkpoint.durationMs <= 0 ||
            checkpoint.durationMs > 1800000 ||
            checkpoint.result?.durationMs !== checkpoint.durationMs ||
            checkpoint.startMs !==
              Number(name.match(/-(\d+)\.json$/)![1]) * 1800000 ||
            !asrSchema.safeParse(checkpoint.result).success
          )
            return null;
          return {
            startMs: checkpoint.startMs as number,
            durationMs: checkpoint.durationMs as number,
            segments: checkpoint.result.segments.length as number,
          };
        } catch {
          return null;
        }
      }),
  );
  return windows
    .filter((value) => value !== null)
    .sort((a, b) => a.startMs - b.startMs);
}

export async function getProcessingDetails(
  uploadId: string,
  runId?: string,
  signal?: AbortSignal,
) {
  const [source] = await db
    .select({
      id: uploads.id,
      filename: uploads.filename,
      storageKey: assets.storageKey,
    })
    .from(uploads)
    .innerJoin(assets, eq(uploads.assetId, assets.id))
    .where(eq(uploads.id, uploadId));
  if (!source) throw new Error('Upload not found');
  const history = await db
    .select()
    .from(runs)
    .where(eq(runs.uploadId, uploadId))
    .orderBy(desc(runs.createdAt))
    .limit(20);
  const selected = runId ? history.find((run) => run.id === runId) : history[0];
  if (!selected) throw new Error('Processing run not found for this upload');
  const retryPending = await processingRetryPending(
    selected.id,
    selected.state,
  );
  const events = await readProcessingEvents(selected.id).catch(() => []);
  let failure = events.findLast((event) => event.failure)?.failure ?? null;
  let failureSource: 'processing_log' | 'worker_queue' | 'run_record' | null =
    failure ? 'processing_log' : null;
  if (!failure) {
    try {
      const [job] =
        await sqlClient`select output from pgboss.job where name='interpret' and data->>'runId'=${selected.id} and output is not null order by created_on desc limit 1`;
      if (typeof job?.output?.message === 'string') {
        const error = new Error(job.output.message);
        if (typeof job.output.name === 'string') error.name = job.output.name;
        error.stack =
          typeof job.output.stack === 'string' ? job.output.stack : undefined;
        failure = describeProcessingFailure(error);
        failureSource = 'worker_queue';
      }
    } catch {
      /* Older workspaces may have no retained queue error. */
    }
  }
  if (!failure && selected.error) {
    const error = new Error(selected.error);
    error.stack = undefined;
    failure = describeProcessingFailure(error);
    failureSource = 'run_record';
  }
  let live: z.infer<typeof liveSchema> | null = null;
  if (selected.state === 'processing') {
    try {
      const response = await fetch(`${config.mediaUrl}/jobs/${selected.id}`, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
          : AbortSignal.timeout(3000),
      });
      const parsed = response.ok
        ? liveSchema.safeParse(await response.json())
        : null;
      if (parsed?.success && parsed.data.jobId === selected.id)
        live = parsed.data;
    } catch {
      /* A progress probe never changes or fails the processing job. */
    }
  }
  return {
    uploadId,
    filename: source.filename,
    selectedRunId: selected.id,
    runs: history.map((run) => ({
      id: run.id,
      state: run.state,
      attempts: run.attempts,
      progress: redactDiagnostic(run.progress),
      progressPercent: run.progressPercent,
      error: run.error ? redactDiagnostic(run.error) : null,
      inputRevisionId: run.inputRevisionId,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      retryPending: run.id === selected.id && retryPending,
    })),
    events,
    failure,
    failureSource,
    live,
    cachedWindows: await savedWindows(source.id, source.storageKey),
  };
}

export type ProcessingDetails = Awaited<
  ReturnType<typeof getProcessingDetails>
>;
