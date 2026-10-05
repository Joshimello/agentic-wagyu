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
async function mediaRequest(route: string, body: unknown) {
  const r = await fetch(`${config.mediaUrl}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(960000),
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(
      typeof result.detail === 'string'
        ? result.detail
        : `Media ${route} failed`,
    );
  return result;
}
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
export async function getContactSheet(storageKey: string, timesMs: number[]) {
  const { timesMs: times } = contactArguments.parse({ timesMs });
  const sheet = sheetSchema.parse(
    await mediaRequest('contact-sheet', { storageKey, timesMs: times }),
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
  onProgress: (message: string) => Promise<void>,
) {
  const cacheDir = assetPath(`runs/${runId}`);
  await mkdir(cacheDir, { recursive: true });
  const meta = z
    .object({ durationMs: z.number().int().positive(), hasAudio: z.boolean() })
    .parse(await mediaRequest('probe', { storageKey }));
  if (meta.durationMs > 4 * 60 * 60 * 1000)
    throw new Error(
      'Recording exceeds the four-hour processing limit; original is preserved.',
    );
  async function transcribeWindows(windowMs: number) {
    const values: unknown[] = [];
    const sections = audioSections(meta.durationMs, windowMs);
    for (const section of sections) {
      await onProgress(
        `Transcribing ${windowMs / 60000}-minute audio window ${section.index + 1}/${sections.length} with local MOSS`,
      );
      const path = `${cacheDir}/part-${windowMs}-${section.index}.json`;
      let value: unknown;
      try {
        const checkpoint = await Bun.file(path).json();
        if (
          checkpoint.storageKey !== storageKey ||
          checkpoint.startMs !== section.startMs ||
          checkpoint.durationMs !== section.durationMs ||
          checkpoint.version !== 2
        )
          throw new Error('Checkpoint does not match recording');
        asrSchema.parse(checkpoint.result);
        value = checkpoint.result;
      } catch {
        value = await mediaRequest('transcribe', {
          storageKey,
          startMs: section.startMs,
          durationMs: section.durationMs,
        });
        asrSchema.parse(value);
        const temp = `${cacheDir}/${crypto.randomUUID()}.tmp`;
        await Bun.write(
          temp,
          JSON.stringify({ version: 2, storageKey, ...section, result: value }),
        );
        await rename(temp, path);
      }
      values.push(value);
    }
    return asrSchema.parse(
      joinAudioSections(meta.durationMs, values, windowMs),
    );
  }
  let windowMs = 90 * 60 * 1000;
  let result = await transcribeWindows(windowMs);
  if (
    (result.incomplete || result.truncated) &&
    meta.durationMs > 30 * 60 * 1000 &&
    meta.hasAudio
  ) {
    await onProgress(
      'Long-pass coverage is uncertain; recovering speech in 30-minute windows',
    );
    windowMs = 30 * 60 * 1000;
    result = await transcribeWindows(windowMs);
    result.warnings = [
      ...(result.warnings ?? []),
      'The long MOSS pass ended early or reached its output limit. Speech was recovered in 30-minute windows; speaker matching across windows remains unverified.',
    ];
  }
  const temp = `${cacheDir}/${crypto.randomUUID()}.tmp`;
  await Bun.write(temp, JSON.stringify(result));
  await rename(temp, `${cacheDir}/asr.json`);
  applyTranscript(stage, result);
  stage.provenance = {
    adapter: 'video-3-context',
    model: result.model,
    modelRevision: result.revision,
    promptVersion: contextPromptVersion,
    transcription: {
      runId,
      windowMs,
      scope: meta.durationMs <= windowMs ? 'recording' : 'window',
    },
  };
  await revisitContext(stage, storageKey, onProgress);
  return stage;
}
/** Revisit visuals without rerunning ASR or replacing user-corrected speech. */
export async function revisitContext(
  stage: Stage,
  storageKey: string,
  progress: (message: string) => Promise<void> = async () => {},
) {
  stage.primitives = stage.primitives.filter((p) => p.kind === 'text');
  stage.annotations = [];
  delete stage.context;
  delete stage.speakerSuggestions;
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
      (times) => getContactSheet(storageKey, times),
      progress,
    );
  } catch (error) {
    console.error('Context planning failed', {
      errorType: error instanceof Error ? error.name : 'Unknown',
    });
    stage.primitives = speech;
    stage.annotations = [];
    delete stage.context;
    delete stage.speakerSuggestions;
    stage.coverage.warnings = [
      ...warnings,
      'Visual enrichment could not read/validate the transcript plan. Spoken transcript is preserved; revisit visual context to retry.',
    ];
    stage.coverage.complete = false;
  }
  return stage;
}
