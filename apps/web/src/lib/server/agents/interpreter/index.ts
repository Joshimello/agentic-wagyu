import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, sqlClient } from '../../db/client';
import { currentOperation, withOperation } from '../../jobs/operation';
import { assets, uploads, runs, revisions } from '../../db/schema';
import {
  boundedProgress,
  watchJob,
  type JobProgress,
} from '../../jobs/control';
import { config } from '../../config';
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
import { enrichDocument } from './document-review';
import { enqueueSummary } from '../../services/summaries';
import {
  describeProcessingFailure,
  recordProcessingEvent,
} from './diagnostics';

export async function interpret(
  runId: string,
  options: { signal?: AbortSignal; buildVideo?: typeof buildVideo } = {},
) {
  return withOperation(
    { kind: 'interpret', id: runId, signal: options.signal },
    () =>
      interpretLeased(runId, {
        ...options,
        signal: currentOperation()?.signal,
      }),
  );
}
async function interpretLeased(
  runId: string,
  options: { signal?: AbortSignal; buildVideo?: typeof buildVideo },
) {
  const connection = await sqlClient.reserve();
  let locked = false;
  try {
    const [lock] =
      await connection`select pg_try_advisory_lock(hashtextextended(${runId}, 72418)) as locked`;
    locked = !!lock.locked;
  } catch (error) {
    connection.release();
    throw error;
  }
  if (!locked) {
    connection.release();
    return;
  }
  const control = watchJob(async () => {
    const [current] = await db
      .select({ state: runs.state, deletedAt: uploads.deletedAt })
      .from(runs)
      .innerJoin(uploads, eq(runs.uploadId, uploads.id))
      .where(eq(runs.id, runId));
    return (
      !!current &&
      ['queued', 'processing', 'failed'].includes(current.state) &&
      !current.deletedAt
    );
  }, options.signal);
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    if (!run || run.revisionId || run.state === 'canceled') return;
    let state = run.state as RunState;
    if (state === 'failed') state = transition(state, 'queued');
    if (state !== 'processing') transition(state, 'processing');
    const claimed = await db
      .update(runs)
      .set({
        state: 'processing',
        progress: 'Extracting source',
        attempts: sql`${runs.attempts}+1`,
        progressPercent: 0,
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runs.id, runId),
          inArray(runs.state, ['queued', 'failed', 'processing']),
          sql`exists (select 1 from ${uploads} where ${uploads.id} = ${runs.uploadId} and ${uploads.deletedAt} is null)`,
        ),
      )
      .returning();
    if (!claimed.length) return;
    const attempt = claimed[0].attempts;
    let phase = 'Extracting source';
    let loggedPhase = phase,
      loggedPercent = 0;
    await recordProcessingEvent(runId, {
      attempt,
      level: 'info',
      phase,
      message: `Processing attempt ${attempt} started. Completed audio windows are reused.`,
      percent: 0,
    });
    try {
      const [input] = await db
        .select()
        .from(uploads)
        .innerJoin(assets, eq(uploads.assetId, assets.id))
        .where(eq(uploads.id, run.uploadId));
      if (!input || input.uploads.deletedAt) return;
      await control.assertActive();
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
      const progress: JobProgress = async (message, percent) => {
        await control.assertActive();
        phase = message;
        await db
          .update(runs)
          .set({
            progress: message,
            ...(percent === undefined
              ? {}
              : {
                  progressPercent: sql`greatest(${runs.progressPercent}, ${boundedProgress(percent)})`,
                }),
            updatedAt: new Date(),
          })
          .where(and(eq(runs.id, runId), eq(runs.state, 'processing')));
        if (
          message !== loggedPhase ||
          (percent !== undefined && percent >= loggedPercent + 5)
        ) {
          await recordProcessingEvent(runId, {
            attempt,
            level: 'info',
            phase: message,
            message,
            ...(percent === undefined
              ? {}
              : { percent: boundedProgress(percent) }),
          });
          loggedPhase = message;
          if (percent !== undefined) loggedPercent = boundedProgress(percent);
        }
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
          (!documentFormat(upload.filename) &&
            !/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(upload.filename))
        )
          throw new Error('Description input is not a revision of this source');
        stage = validateStage(structuredClone(base.manifest));
        stage.id = crypto.randomUUID();
        stage.parentRevisionId = base.id;
        stage.createdAt = new Date().toISOString();
        if (stage.document) {
          const previous = stage.document.review;
          stage.coverage.warnings = stage.coverage.warnings.filter(
            (warning) =>
              !previous?.warnings.includes(warning) &&
              !warning.startsWith('Source text was corrected;') &&
              !warning.startsWith(
                'Document labels and summary are unavailable;',
              ),
          );
          stage.provenance.adapter = 'document-review-revisit-1';
          await enrichDocument(
            stage,
            raw.storageKey,
            progress,
            undefined,
            undefined,
            control.signal,
          );
        } else {
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
          await revisitContext(
            stage,
            raw.storageKey,
            progress,
            control.signal,
            runId,
          );
        }
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
        stage = await (options.buildVideo ?? buildVideo)(
          stage,
          raw.storageKey,
          runId,
          progress,
          control.signal,
        );
      } else if (documentFormat(upload.filename)) {
        await buildDocument(
          stage,
          raw.storageKey,
          documentFormat(upload.filename)!,
          progress,
          control.signal,
          runId,
        );
      } else
        throw new Error(
          'This file adapter is not available yet. Your original is preserved; retry after the adapter is installed.',
        );
      await progress('Saving the reviewed source', 98);
      validateStage(stage);
      await db.transaction(async (tx) => {
        // All user actions lock upload before run; cancellation wins atomically.
        const [current] = await tx
          .select()
          .from(uploads)
          .where(eq(uploads.id, upload.id))
          .for('update');
        const [locked] = await tx
          .select()
          .from(runs)
          .where(eq(runs.id, runId))
          .for('update');
        if (
          !current ||
          current.deletedAt ||
          !locked ||
          locked.revisionId ||
          locked.state !== 'processing' ||
          locked.attempts !== claimed[0].attempts
        )
          return;
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
        await enqueueSummary(tx, stage);
        await tx
          .update(runs)
          .set({
            state: stage.coverage.warnings.length
              ? 'ready_with_warnings'
              : 'ready',
            progress: 'Ready for review',
            progressPercent: 100,
            revisionId: stage.id,
            updatedAt: new Date(),
          })
          .where(eq(runs.id, runId));
      });
      const [completed] = await db
        .select()
        .from(runs)
        .where(eq(runs.id, runId));
      if (completed?.revisionId === stage.id)
        await recordProcessingEvent(runId, {
          attempt,
          level: stage.coverage.warnings.length ? 'warning' : 'info',
          phase: 'Ready for review',
          message: stage.coverage.warnings.length
            ? `Processing completed with ${stage.coverage.warnings.length} review warnings.`
            : 'Processing completed.',
          percent: 100,
        });
    } catch (error) {
      const [current] = await db.select().from(runs).where(eq(runs.id, runId));
      if (current?.state === 'canceled') {
        await recordProcessingEvent(runId, {
          attempt,
          level: 'info',
          phase,
          message: 'Processing canceled. Completed work is retained.',
        });
        try {
          await fetch(`${config.mediaUrl}/jobs/${runId}/cancel`, {
            method: 'POST',
            signal: AbortSignal.timeout(5000),
          });
        } catch {}
        return;
      }
      const failure = describeProcessingFailure(error);
      await recordProcessingEvent(runId, {
        attempt,
        level: 'error',
        phase,
        message: failure.message,
        failure,
      });
      console.error('Interpretation failed', {
        runId,
        attempt,
        phase,
        code: failure.code,
        message: failure.message,
      });
      await db
        .update(runs)
        .set({
          state: 'failed',
          progress: 'Interpretation failed',
          error: `${failure.message.slice(0, 1000)} Original files and completed work are retained.`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(runs.id, runId),
            eq(runs.state, 'processing'),
            eq(runs.attempts, claimed[0].attempts),
          ),
        );
      if (
        (await db.select().from(runs).where(eq(runs.id, runId)))[0]?.state ===
        'canceled'
      )
        return;
      if (!failure.retryable) return;
      const safeError = new Error(failure.message);
      safeError.name = failure.type;
      safeError.stack = failure.stack || undefined;
      throw safeError;
    }
  } finally {
    control.stop();
    try {
      await connection`select pg_advisory_unlock(hashtextextended(${runId}, 72418))`;
    } finally {
      connection.release();
    }
  }
}
