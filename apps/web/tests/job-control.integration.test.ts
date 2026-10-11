import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, sqlClient } from '../src/lib/server/db/client';
import {
  assets,
  revisions,
  runs,
  translationJobs,
  uploads,
  pushBatches,
} from '../src/lib/server/db/schema';
import type { Stage } from '../src/lib/server/contracts';
import {
  cancelUploadRun,
  retryUpload,
} from '../src/lib/server/services/uploads';
import {
  cancelTranslation,
  getTranslation,
  requestTranslation,
} from '../src/lib/server/services/translations';
import { interpret } from '../src/lib/server/agents/interpreter';
import { translateRevision } from '../src/lib/server/agents/translation';
import {
  cancelPush,
  createPush,
  getPush,
  retryPush,
} from '../src/lib/server/services/pushes';
import { chronicle } from '../src/lib/server/agents/chronicler';
import { boundedProgress, watchJob } from '../src/lib/server/jobs/control';
import { dispatchPending } from '../src/lib/server/jobs/queue';
import { dispatchTranslations } from '../src/lib/server/jobs/translations';
import { outbox, translationOutbox } from '../src/lib/server/db/schema';
import type { PgBoss } from 'pg-boss';
import type { llmClient } from '../src/lib/server/llm/client';

const enabled = process.env.CONTROL_TEST_DATABASE === '1';
if (
  enabled &&
  !/^chronicler_control_test_/.test(
    new URL(process.env.DATABASE_URL!).pathname.slice(1),
  )
)
  throw new Error('Cancellation tests require their isolated database');
const check = test.skipIf(!enabled);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});

async function fixture(segments = 2) {
  const assetId = crypto.randomUUID(),
    uploadId = crypto.randomUUID(),
    runId = crypto.randomUUID();
  const stage: Stage = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    uploadId,
    rawAssetId: assetId,
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      label: 'Research control regression',
      sourceTime: null,
      sourceTimeOrigin: 'unknown',
    },
    primitives: Array.from({ length: segments }, (_, index) => ({
      id: crypto.randomUUID(),
      kind: 'text',
      role: 'asr',
      text: `Research observation ${index}`,
      speaker: 'S01',
      locator: {
        kind: 'media',
        timeline: 'container',
        startMs: index * 1000,
        endMs: (index + 1) * 1000,
      },
    })),
    annotations: [],
    coverage: { complete: true, durationMs: segments * 1000, warnings: [] },
    provenance: {
      adapter: 'video',
      model: 'MOSS',
      modelRevision: 'pinned',
      promptVersion: null,
    },
  };
  await db.insert(assets).values({
    id: assetId,
    sha256: crypto.randomUUID(),
    storageKey: 'control-unused',
    mime: 'video/mp4',
    bytes: 1,
  });
  await db.insert(uploads).values({
    id: uploadId,
    assetId,
    filename: 'research.mp4',
    metadata: stage.metadata,
    currentRevisionId: stage.id,
  });
  await db
    .insert(revisions)
    .values({ id: stage.id, uploadId, manifest: stage });
  await db.insert(runs).values({ id: runId, uploadId });
  return { stage, runId };
}

check(
  'cancel is owned, idempotent, stops a queued run and preserves the current revision',
  async () => {
    const { stage, runId } = await fixture(),
      other = await fixture();
    await expect(cancelUploadRun(other.stage.uploadId, runId)).rejects.toThrow(
      'Run not found',
    );
    await db
      .update(runs)
      .set({ progressPercent: 35 })
      .where(eq(runs.id, runId));
    expect(await cancelUploadRun(stage.uploadId, runId)).toMatchObject({
      state: 'canceled',
      progressPercent: 35,
    });
    expect(await cancelUploadRun(stage.uploadId, runId)).toMatchObject({
      state: 'canceled',
      progressPercent: 35,
    });
    let called = false;
    await interpret(runId, {
      buildVideo: async (value) => {
        called = true;
        return value;
      },
    });
    expect(called).toBe(false);
    expect(
      (await db.select().from(uploads).where(eq(uploads.id, stage.uploadId)))[0]
        .currentRevisionId,
    ).toBe(stage.id);
    expect(
      (await db.select().from(runs).where(eq(runs.id, other.runId)))[0].state,
    ).toBe('queued');
    expect(await retryUpload(stage.uploadId, stage.id)).not.toBe(runId);
  },
);

check(
  'late interpretation success and failure cannot publish or replace cancellation',
  async () => {
    for (const fail of [false, true]) {
      const { stage, runId } = await fixture();
      await interpret(runId, {
        buildVideo: async (value, _key, _id, progress) => {
          await progress('Audio window completed', 70);
          await cancelUploadRun(stage.uploadId, runId);
          if (fail) throw new Error('Late provider error');
          return value;
        },
      });
      expect(
        (await db.select().from(runs).where(eq(runs.id, runId)))[0],
      ).toMatchObject({
        state: 'canceled',
        revisionId: null,
        progressPercent: 70,
        error: null,
      });
      expect(
        await db.select().from(revisions).where(eq(revisions.runId, runId)),
      ).toHaveLength(0);
      expect(
        (
          await db.select().from(uploads).where(eq(uploads.id, stage.uploadId))
        )[0].currentRevisionId,
      ).toBe(stage.id);
    }
  },
);

check(
  'only atomic publication reaches 100 and a completed run cannot be canceled',
  async () => {
    const { stage, runId } = await fixture();
    await interpret(runId, {
      buildVideo: async (value, _key, _id, progress) => {
        await progress('Work completed', 100);
        expect(
          (await db.select().from(runs).where(eq(runs.id, runId)))[0]
            .progressPercent,
        ).toBe(99);
        return value;
      },
    });
    const ready = await cancelUploadRun(stage.uploadId, runId);
    expect(ready.state).toBe('ready');
    expect(ready.progressPercent).toBe(100);
    expect(ready.revisionId).not.toBeNull();
  },
);

check(
  'translation cancellation keeps completed batches, isolates targets and prevents stale generation writes',
  async () => {
    const { stage } = await fixture(35),
      other = await fixture();
    const input = { revisionId: stage.id, language: 'en' },
      job = await requestTranslation(stage.uploadId, input);
    await expect(
      cancelTranslation(other.stage.uploadId, job.id!),
    ).rejects.toThrow('Translation not found');
    const otherLanguage = await requestTranslation(stage.uploadId, {
      ...input,
      language: 'zh-TW',
    });
    let calls = 0;
    await translateRevision(job.id!, {
      translate: async (parts) => {
        if (++calls === 2) {
          await cancelTranslation(stage.uploadId, job.id!);
          // Restart immediately while the old worker still owns its advisory lock.
          await requestTranslation(stage.uploadId, input);
          throw new Error('Late old generation failure');
        }
        return parts.map((part) => ({
          ref: part.ref,
          text: `Translated ${part.text}`,
        }));
      },
    });
    expect(await getTranslation(stage.uploadId, input)).toMatchObject({
      state: 'queued',
      completedSegments: 16,
    });
    expect(
      (
        await db
          .select()
          .from(translationJobs)
          .where(eq(translationJobs.id, otherLanguage.id!))
      )[0].state,
    ).toBe('queued');
    const resumed: string[] = [];
    await translateRevision(job.id!, {
      translate: async (parts) => {
        resumed.push(...parts.map((part) => part.ref));
        return parts.map((part) => ({
          ref: part.ref,
          text: `Translated ${part.text}`,
        }));
      },
    });
    expect(resumed).toHaveLength(19);
    expect(await getTranslation(stage.uploadId, input)).toMatchObject({
      state: 'ready',
      completedSegments: 35,
      progressPercent: 100,
    });
  },
);

check(
  'canceled translation ignores late success and can resume its checkpoint',
  async () => {
    const { stage } = await fixture(35),
      input = { revisionId: stage.id, language: 'en' };
    const job = await requestTranslation(stage.uploadId, input);
    let calls = 0;
    await translateRevision(job.id!, {
      translate: async (parts) => {
        if (++calls === 2) await cancelTranslation(stage.uploadId, job.id!);
        return parts.map((part) => ({
          ref: part.ref,
          text: `Translated ${part.text}`,
        }));
      },
    });
    expect(await getTranslation(stage.uploadId, input)).toMatchObject({
      state: 'canceled',
      completedSegments: 16,
    });
    expect(await cancelTranslation(stage.uploadId, job.id!)).toMatchObject({
      state: 'canceled',
      completedSegments: 16,
    });
  },
);

check(
  'a cross-process cancellation aborts the active translation model request',
  async () => {
    const { stage } = await fixture(),
      input = { revisionId: stage.id, language: 'en' };
    const job = await requestTranslation(stage.uploadId, input);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false,
      calls = 0;
    const llm = {
      model: 'cancel-active-request',
      client: {
        chat: {
          completions: {
            create: async (
              _input: unknown,
              options: { signal: AbortSignal },
            ) => {
              calls++;
              started();
              return new Promise((_resolve, reject) => {
                options.signal.addEventListener(
                  'abort',
                  () => {
                    aborted = true;
                    reject(new Error('SDK request aborted'));
                  },
                  { once: true },
                );
              });
            },
          },
        },
      },
    } as unknown as ReturnType<typeof llmClient>;
    const processing = translateRevision(job.id!, { llm });
    await ready;
    await cancelTranslation(stage.uploadId, job.id!);
    await processing;
    expect(aborted).toBe(true);
    expect(calls).toBe(1);
    expect(await getTranslation(stage.uploadId, input)).toMatchObject({
      state: 'canceled',
      completedSegments: 0,
    });
  },
);

check(
  'durable dispatch skips canceled runs and translations, including stale outbox rows',
  async () => {
    const { stage, runId } = await fixture();
    await db.insert(outbox).values({ id: runId });
    const job = await requestTranslation(stage.uploadId, {
      revisionId: stage.id,
      language: 'en',
    });
    await cancelUploadRun(stage.uploadId, runId);
    await cancelTranslation(stage.uploadId, job.id!);
    // Simulate an old outbox delivery racing the cancellation transaction.
    await db
      .update(outbox)
      .set({ dispatchedAt: null })
      .where(eq(outbox.id, runId));
    await db
      .update(translationOutbox)
      .set({ dispatchedAt: null })
      .where(eq(translationOutbox.id, job.id!));
    const sent: string[] = [];
    const boss = {
      send: async (
        _queue: string,
        data: { runId?: string; translationId?: string },
      ) => {
        sent.push(data.runId ?? data.translationId!);
        return crypto.randomUUID();
      },
    } as unknown as PgBoss;
    await dispatchPending(boss);
    await dispatchTranslations(boss);
    expect(sent).not.toContain(runId);
    expect(sent).not.toContain(job.id!);
  },
);

check(
  'memory cancellation stops publication and late failures, with a fresh generation on retry',
  async () => {
    const { stage } = await fixture();
    const batch = await createPush({
      idempotencyKey: crypto.randomUUID(),
      items: [
        {
          uploadId: stage.uploadId,
          revisionId: stage.id,
          acceptPartial: false,
        },
      ],
      projectScope: { mode: 'auto' },
    });
    await chronicle(batch.id, {
      buildPlan: async (_id, _input, _stages, snapshot, options) => {
        await options!.progress!('Evidence read', 65);
        await cancelPush(batch.id);
        throw new Error('Late memory failure');
      },
    });
    expect(await getPush(batch.id)).toMatchObject({
      state: 'canceled',
      progressPercent: 65,
      commitVersion: null,
    });
    expect(await cancelPush(batch.id)).toMatchObject({ state: 'canceled' });
    await retryPush(batch.id);
    expect(await getPush(batch.id)).toMatchObject({
      state: 'queued',
      generation: 2,
    });
    let staleCalled = false;
    await chronicle(batch.id, {
      generation: 0,
      buildPlan: async () => {
        staleCalled = true;
        throw new Error('Stale work must not execute');
      },
    });
    expect(staleCalled).toBe(false);
    const [count] =
      await sqlClient`select count(*)::int as count from memory_commits`;
    expect(count.count).toBe(0);
  },
);

check(
  'archived sources reject interpretation, translation and memory retries',
  async () => {
    const { stage, runId } = await fixture();
    await db
      .update(uploads)
      .set({ deletedAt: new Date() })
      .where(eq(uploads.id, stage.uploadId));
    await expect(retryUpload(stage.uploadId)).rejects.toThrow(
      'Upload not found',
    );
    await expect(
      requestTranslation(stage.uploadId, {
        revisionId: stage.id,
        language: 'en',
      }),
    ).rejects.toThrow('Upload not found');
    await expect(
      createPush({
        idempotencyKey: crypto.randomUUID(),
        items: [
          {
            uploadId: stage.uploadId,
            revisionId: stage.id,
            acceptPartial: false,
          },
        ],
        projectScope: { mode: 'auto' },
      }),
    ).rejects.toThrow('removed');
    let called = false;
    await interpret(runId, {
      buildVideo: async (value) => {
        called = true;
        return value;
      },
    });
    expect(called).toBe(false);
  },
);

check(
  'failed advisory lock queries release reserved worker connections',
  async () => {
    const previousReserve = sqlClient.reserve;
    let released = 0;
    const connection = Object.assign(
      async () => {
        throw new Error('Injected lock acquisition failure');
      },
      {
        release: () => {
          released++;
        },
      },
    );
    sqlClient.reserve = async () =>
      connection as unknown as Awaited<ReturnType<typeof previousReserve>>;
    try {
      await expect(interpret(crypto.randomUUID())).rejects.toThrow(
        'Injected lock acquisition failure',
      );
      await expect(chronicle(crypto.randomUUID())).rejects.toThrow(
        'Injected lock acquisition failure',
      );
      expect(released).toBe(2);
    } finally {
      sqlClient.reserve = previousReserve;
    }
  },
);

test('worker cancellation signal aborts and progress stays bounded before publication', async () => {
  let active = true;
  const monitor = watchJob(async () => active);
  try {
    await monitor.assertActive();
    active = false;
    await expect(monitor.assertActive()).rejects.toThrow('canceled');
    expect(monitor.signal.aborted).toBe(true);
    expect([
      boundedProgress(-1),
      boundedProgress(44.9),
      boundedProgress(100),
    ]).toEqual([0, 44, 99]);
  } finally {
    monitor.stop();
  }
});
