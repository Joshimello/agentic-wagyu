import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { mkdir, rename } from 'node:fs/promises';
import { db } from '../../db/client';
import { assets } from '../../db/schema';
import { config } from '../../config';
import { assetPath } from '../../storage';
import { type Stage, type Primitive } from '../../contracts';
import { contextPromptVersion, enrichContext } from './context';
import { asrSchema, applyTranscript } from './transcript';
import { audioSections, joinAudioSections } from './audio-sections';
import { type JobProgress } from '../../jobs/control';
import { normalizeTranscription } from '../../text-normalization';
import { mediaRequest } from './media-client';

const assetSchema = z.object({
  storageKey: z.string().regex(/^assets\/[a-f0-9]{2}\/[a-f0-9]{64}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  mime: z.literal('image/jpeg'),
});
const sheetSchema = z.object({
  durationMs: z.number().int().positive(),
  sheet: assetSchema,
  frames: z
    .array(
      z.object({
        requestedMs: z.number().int().nonnegative(),
        actualMs: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        asset: assetSchema,
      }),
    )
    .min(1)
    .max(8),
});
export const contactArguments = z
  .object({ timesMs: z.array(z.number().int().nonnegative()).min(1).max(8) })
  .strict();
async function registerAsset(asset: z.infer<typeof assetSchema>) {
  const file = Bun.file(assetPath(asset.storageKey));
  if (file.size !== asset.bytes) throw new Error('Derived asset size mismatch');
  await db
    .insert(assets)
    .values({ id: crypto.randomUUID(), ...asset })
    .onConflictDoNothing({ target: assets.sha256 });
  const [row] = await db
    .select()
    .from(assets)
    .where(eq(assets.sha256, asset.sha256));
  return row;
}
export async function getContactSheet(
  storageKey: string,
  timesMs: number[],
  signal?: AbortSignal,
  jobId?: string,
) {
  const { timesMs: times } = contactArguments.parse({ timesMs });
  const sheet = sheetSchema.parse(
    await mediaRequest(
      'contact-sheet',
      { storageKey, timesMs: times, jobId },
      signal,
    ),
  );
  const frames: Primitive[] = [];
  for (const frame of sheet.frames) {
    const asset = await registerAsset(frame.asset);
    frames.push({
      id: crypto.randomUUID(),
      kind: 'image',
      role: 'frame',
      assetId: asset.id,
      requestedMs: frame.requestedMs,
      actualMs: frame.actualMs,
      locator: {
        kind: 'media',
        timeline: 'container',
        startMs: frame.actualMs,
        endMs: frame.actualMs,
      },
    });
  }
  const bytes = await Bun.file(assetPath(sheet.sheet.storageKey)).arrayBuffer();
  return {
    frames,
    image: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`,
  };
}

export async function buildVideo(
  stage: Stage,
  storageKey: string,
  runId: string,
  onProgress: JobProgress,
  signal?: AbortSignal,
) {
  const cacheDir = assetPath(`runs/${runId}`);
  const windowCacheDir = assetPath(`runs/${stage.uploadId}/moss-windows-v2`);
  await mkdir(cacheDir, { recursive: true });
  await mkdir(windowCacheDir, { recursive: true });
  signal?.throwIfAborted();
  const meta = z
    .object({ durationMs: z.number().int().positive(), hasAudio: z.boolean() })
    .parse(await mediaRequest('probe', { storageKey, jobId: runId }, signal));
  await onProgress('Recording inspected', 5);
  if (meta.durationMs > 4 * 60 * 60 * 1000)
    throw new Error(
      'Recording exceeds the four-hour processing limit; original is preserved.',
    );
  async function transcribeWindows(windowMs: number) {
    const values: unknown[] = [];
    const sections = audioSections(meta.durationMs, windowMs);
    for (const section of sections) {
      signal?.throwIfAborted();
      await onProgress(
        `Transcribing ${windowMs / 60000}-minute audio window ${section.index + 1}/${sections.length} with local MOSS`,
        5 + (65 * section.startMs) / meta.durationMs,
      );
      const path = `${cacheDir}/part-${windowMs}-${section.index}.json`;
      const sharedPath = `${windowCacheDir}/part-${windowMs}-${section.index}.json`;
      let value: unknown;
      let reused = false;
      try {
        const checkpoint = await Bun.file(
          (await Bun.file(path).exists()) ? path : sharedPath,
        ).json();
        if (
          checkpoint.storageKey !== storageKey ||
          checkpoint.startMs !== section.startMs ||
          checkpoint.durationMs !== section.durationMs ||
          checkpoint.version !== 2
        )
          throw new Error('Checkpoint does not match recording');
        asrSchema.parse(checkpoint.result);
        value = checkpoint.result;
        reused = true;
      } catch {
        signal?.throwIfAborted();
        let polling: Promise<void> | undefined;
        let acceptingProgress = true;
        const timer = setInterval(() => {
          if (polling || signal?.aborted || !acceptingProgress) return;
          polling = (async () => {
            try {
              const response = await fetch(`${config.mediaUrl}/jobs/${runId}`, {
                signal: signal
                  ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
                  : AbortSignal.timeout(3000),
              });
              if (!response.ok) return;
              const status = await response.json();
              if (
                !acceptingProgress ||
                signal?.aborted ||
                status.stage !== 'transcribing' ||
                status.startMs !== section.startMs ||
                typeof status.coveredMs !== 'number'
              )
                return;
              const covered = Math.min(
                section.durationMs,
                Math.max(0, status.coveredMs),
              );
              await onProgress(
                `Transcribing audio window ${section.index + 1}/${sections.length} with local MOSS`,
                5 + (65 * (section.startMs + covered)) / meta.durationMs,
              );
            } catch {
            } finally {
              polling = undefined;
            }
          })();
        }, 1500);
        try {
          value = await mediaRequest(
            'transcribe',
            {
              storageKey,
              jobId: runId,
              startMs: section.startMs,
              durationMs: section.durationMs,
            },
            signal,
          );
        } finally {
          acceptingProgress = false;
          clearInterval(timer);
          await polling;
        }
        asrSchema.parse(value);
        const temp = `${cacheDir}/${crypto.randomUUID()}.tmp`;
        await Bun.write(
          temp,
          JSON.stringify({ version: 2, storageKey, ...section, result: value }),
        );
        await rename(temp, path);
        const sharedTemp = `${windowCacheDir}/${crypto.randomUUID()}.tmp`;
        await Bun.write(sharedTemp, Bun.file(path));
        await rename(sharedTemp, sharedPath);
      }
      if (reused)
        await onProgress(
          `Reusing saved audio window ${section.index + 1}/${sections.length}`,
          5 + (65 * section.startMs) / meta.durationMs,
        );
      signal?.throwIfAborted();
      values.push(value);
      await onProgress(
        `Transcribed audio window ${section.index + 1}/${sections.length}`,
        5 + (65 * (section.startMs + section.durationMs)) / meta.durationMs,
      );
    }
    return asrSchema.parse(
      joinAudioSections(meta.durationMs, values, windowMs),
    );
  }
  const windowMs = 30 * 60 * 1000;
  const result = await transcribeWindows(windowMs);
  const temp = `${cacheDir}/${crypto.randomUUID()}.tmp`;
  await Bun.write(temp, JSON.stringify(result));
  await rename(temp, `${cacheDir}/asr.json`);
  stage.provenance = {
    adapter: 'video-4-context',
    model: result.model,
    modelRevision: result.revision,
    promptVersion: contextPromptVersion,
    transcription: {
      runId,
      windowMs,
      scope: meta.durationMs <= windowMs ? 'recording' : 'window',
    },
  };
  applyTranscript(stage, result);
  await revisitContext(stage, storageKey, onProgress, signal, runId);
  return stage;
}
/** Revisit visuals without rerunning ASR or replacing user-corrected speech. */
export async function revisitContext(
  stage: Stage,
  storageKey: string,
  progress: JobProgress = async () => {},
  signal?: AbortSignal,
  jobId?: string,
) {
  signal?.throwIfAborted();
  normalizeTranscription(stage);
  const reviewedNames = (stage.speakerSuggestions ?? []).filter(
    (s) => s.review,
  );
  const reviewedFrames = new Set(reviewedNames.flatMap((s) => s.frameIds));
  stage.primitives = stage.primitives.filter(
    (p) => p.kind === 'text' || reviewedFrames.has(p.id),
  );
  stage.annotations = [];
  delete stage.context;
  stage.speakerSuggestions = reviewedNames;
  stage.coverage.warnings = stage.coverage.warnings.filter(
    (w) =>
      !/visual agent received|visual sampling|sparse visual|visual enrichment|visual coverage|visual response|transcript context questions|transcript questions were deferred|Video frames were selected/i.test(
        w,
      ),
  );
  const speech = [...stage.primitives],
    warnings = [...stage.coverage.warnings];
  stage.provenance.promptVersion = contextPromptVersion;
  try {
    await enrichContext(
      stage,
      (times) => getContactSheet(storageKey, times, signal, jobId),
      progress,
      undefined,
      signal,
    );
  } catch (error) {
    signal?.throwIfAborted();
    console.error('Context planning failed', {
      errorType: error instanceof Error ? error.name : 'Unknown',
    });
    stage.primitives = speech;
    stage.annotations = [];
    delete stage.context;
    stage.speakerSuggestions = reviewedNames;
    stage.coverage.warnings = [
      ...warnings,
      'Visual enrichment could not read/validate the transcript plan. Spoken transcript is preserved; revisit visual context to retry.',
    ];
    stage.coverage.complete = false;
  }
  return stage;
}
