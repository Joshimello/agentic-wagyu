import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { assets, uploads, runs, revisions } from '../../db/schema';
import { assetPath } from '../../storage';
import {
  validateStage,
  transition,
  type RunState,
  type Stage,
} from '../../contracts';
import { buildVideo, revisitContext } from './video';
import { applyTranscript } from './transcript';
import { buildDocument, documentFormat } from './documents';

export async function interpret(runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run || run.revisionId || run.state === 'canceled') return;
  let state = run.state as RunState;
  if (state === 'failed') state = transition(state, 'queued');
  if (state !== 'processing') transition(state, 'processing');
  await db
    .update(runs)
    .set({
      state: 'processing',
      progress: 'Extracting source',
      attempts: sql`${runs.attempts}+1`,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
  try {
    const [input] = await db
      .select()
      .from(uploads)
      .innerJoin(assets, eq(uploads.assetId, assets.id))
      .where(eq(uploads.id, run.uploadId));
    const raw = input.assets,
      upload = input.uploads;
    let stage: Stage = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      uploadId: upload.id,
      rawAssetId: raw.id,
      parentRevisionId: upload.currentRevisionId,
      createdAt: new Date().toISOString(),
      metadata: upload.metadata,
      primitives: [],
      annotations: [],
      coverage: { complete: true, durationMs: null, warnings: [] },
      provenance: {
        adapter: 'text-1',
        model: null,
        modelRevision: null,
        promptVersion: null,
      },
    };
    const progress = async (message: string) => {
      await db
        .update(runs)
        .set({ progress: message, updatedAt: new Date() })
        .where(eq(runs.id, runId));
    };
    if (run.inputRevisionId) {
      const [base] = await db
        .select()
        .from(revisions)
        .where(eq(revisions.id, run.inputRevisionId));
      if (
        !base ||
        base.uploadId !== upload.id ||
        base.manifest.rawAssetId !== raw.id ||
        !/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(upload.filename)
      )
        throw new Error(
          'Visual context input is not a revision of this recording',
        );
      stage = validateStage(structuredClone(base.manifest));
      stage.id = crypto.randomUUID();
      stage.parentRevisionId = base.id;
      stage.createdAt = new Date().toISOString();
      if (!stage.provenance.transcription) {
        // Legacy corrections have no run ID: follow their immutable ancestry
        // rather than claiming this visual-only job transcribed the audio.
        let source = base;
        const visited = new Set([source.id]);
        while (!source.runId && source.parentRevisionId) {
          const [parent] = await db
            .select()
            .from(revisions)
            .where(eq(revisions.id, source.parentRevisionId));
          if (
            !parent ||
            parent.uploadId !== upload.id ||
            visited.has(parent.id)
          )
            break;
          visited.add(parent.id);
          source = parent;
        }
        if (source.runId)
          stage.provenance.transcription = {
            runId: source.runId,
            windowMs: 180000,
            scope: 'window',
          };
      }
      stage.provenance.adapter = 'video-context-revisit-1';
      // Restore ASR coverage independently of earlier visual failures/notes.
      const transcription = stage.provenance.transcription;
      const saved = transcription
        ? Bun.file(assetPath(`runs/${transcription.runId}/asr.json`))
        : null;
      if (saved && (await saved.exists())) {
        const extracted = structuredClone(stage);
        extracted.primitives = [];
        applyTranscript(extracted, await saved.json());
        stage.coverage = extracted.coverage;
      }
      await revisitContext(stage, raw.storageKey, progress);
    } else if (/\.(txt|md|csv|json)$/i.test(upload.filename)) {
      const text = await Bun.file(assetPath(raw.storageKey)).text();
      stage.primitives.push({
        id: crypto.randomUUID(),
        kind: 'text',
        role: 'native',
        text,
        speaker: null,
        locator: { kind: 'text', start: 0, end: text.length },
      });
    } else if (/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(upload.filename)) {
      stage = await buildVideo(
        stage,
        raw.storageKey,
        runId,
        async (progress) => {
          await db
            .update(runs)
            .set({ progress, updatedAt: new Date() })
            .where(eq(runs.id, runId));
        },
      );
    } else if (documentFormat(upload.filename)) {
      await buildDocument(
        stage,
        raw.storageKey,
        documentFormat(upload.filename)!,
        progress,
      );
    } else
      throw new Error(
        'This file adapter is not available yet. Your original is preserved; retry after the adapter is installed.',
      );
    validateStage(stage);
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(runs)
        .where(eq(runs.id, runId))
        .for('update');
      if (locked.revisionId) return;
      const [current] = await tx
        .select()
        .from(uploads)
        .where(eq(uploads.id, upload.id))
        .for('update');
      if (current.currentRevisionId === stage.parentRevisionId)
        await tx
          .update(uploads)
          .set({ currentRevisionId: stage.id })
          .where(eq(uploads.id, upload.id));
      else
        stage.coverage.warnings.push(
          'A newer correction remains current; this interpretation is available in revision history.',
        );
      await tx.insert(revisions).values({
        id: stage.id,
        uploadId: upload.id,
        runId,
        parentRevisionId: stage.parentRevisionId,
        manifest: stage,
      });
      await tx
        .update(runs)
        .set({
          state: stage.coverage.warnings.length
            ? 'ready_with_warnings'
            : 'ready',
          progress: 'Ready for review',
          revisionId: stage.id,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, runId));
    });
  } catch (error) {
    await db
      .update(runs)
      .set({
        state: 'failed',
        progress: 'Interpretation failed',
        error: error instanceof Error ? error.message : 'Interpretation failed',
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId));
    throw error;
  }
}
