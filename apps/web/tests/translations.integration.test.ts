import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, sqlClient } from '../src/lib/server/db/client';
import {
  assets,
  revisions,
  translationJobs,
  translationOutbox,
  uploads,
} from '../src/lib/server/db/schema';
import type { Stage } from '../src/lib/server/contracts';
import {
  getTranslation,
  requestTranslation,
} from '../src/lib/server/services/translations';
import { translateRevision } from '../src/lib/server/agents/translation';
import { correctStage } from '../src/lib/server/services/staging';
import {
  startTranslationQueue,
  dispatchTranslations,
  reconcileTranslations,
  translationQueue,
} from '../src/lib/server/jobs/translations';
import { stableId } from '../src/lib/server/contracts/memory';

const enabled = process.env.TRANSLATION_TEST_DATABASE === '1';
if (
  enabled &&
  !/^chronicler_translation_test_/.test(
    new URL(process.env.DATABASE_URL!).pathname.slice(1),
  )
)
  throw new Error(
    'Translation integration tests require their isolated database',
  );
const check = test.skipIf(!enabled);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});

async function fixture(count = 1) {
  const assetId = crypto.randomUUID(),
    uploadId = crypto.randomUUID();
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
      label: 'Translation regression',
      sourceTime: null,
      sourceTimeOrigin: 'unknown',
    },
    primitives: Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      kind: 'text',
      role: 'asr',
      text: `Research observation ${i}`,
      speaker: 'S01',
      locator: {
        kind: 'media',
        timeline: 'container',
        startMs: i * 1000,
        endMs: (i + 1) * 1000,
      },
    })),
    annotations: [],
    coverage: { complete: true, durationMs: count * 1000, warnings: [] },
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
    storageKey: 'translation-test-unused',
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
  return stage;
}

const translate = async (parts: readonly { ref: string; text: string }[]) =>
  parts.map((part) => ({ ref: part.ref, text: `Translated: ${part.text}` }));

check(
  'concurrent requests enqueue one pinned job and cache complete results without changing source or memory',
  async () => {
    const stage = await fixture(3);
    const input = { revisionId: stage.id, language: 'en' };
    expect((await getTranslation(stage.uploadId, input)).state).toBe(
      'not_requested',
    );
    const requests = await Promise.all([
      requestTranslation(stage.uploadId, input),
      requestTranslation(stage.uploadId, input),
    ]);
    expect(requests[0].id).toBe(requests[1].id);
    await translateRevision(requests[0].id!, { translate });
    const ready = await requestTranslation(stage.uploadId, input);
    expect(ready).toMatchObject({
      state: 'ready',
      completedSegments: 3,
      totalSegments: 3,
      model: 'injected-test-translator',
    });
    expect(ready.translations.map((p) => p.primitiveId)).toEqual(
      stage.primitives.map((p) => p.id),
    );
    const [original] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, stage.id));
    expect(original.manifest).toEqual(stage);
    const [memory] =
      await sqlClient`select count(*)::int as count from memory_commits`;
    expect(memory.count).toBe(0);
  },
);

check(
  'exhausted or cancelled queue jobs make interrupted processing visibly retryable',
  async () => {
    const stage = await fixture(),
      input = { revisionId: stage.id, language: 'en' };
    const requested = await requestTranslation(stage.uploadId, input);
    const boss = await startTranslationQueue();
    try {
      await dispatchTranslations(boss);
      await boss.cancel(
        translationQueue,
        stableId(requested.id!, 'translation-queue', '0'),
      );
      // PostgreSQL timestamps retain finer precision than JavaScript dates.
      await sqlClient`update transcript_translations set state='processing', updated_at=now()-interval '1 minute' where id=${requested.id!}::uuid`;
      await reconcileTranslations(boss);
      expect(await getTranslation(stage.uploadId, input)).toMatchObject({
        state: 'failed',
        completedSegments: 0,
      });
      expect((await requestTranslation(stage.uploadId, input)).state).toBe(
        'queued',
      );
    } finally {
      await boss.stop({ graceful: true });
    }
  },
);

check(
  'failed translation retries saved batches and never publishes an incomplete mapping as ready',
  async () => {
    const stage = await fixture(35);
    const input = { revisionId: stage.id, language: 'en' };
    const job = await requestTranslation(stage.uploadId, input);
    let calls = 0;
    await expect(
      translateRevision(job.id!, {
        translate: async (parts) => {
          if (++calls === 2) throw new Error('Injected interruption');
          return translate(parts);
        },
      }),
    ).rejects.toThrow('Injected interruption');
    expect(await getTranslation(stage.uploadId, input)).toMatchObject({
      state: 'failed',
      completedSegments: 16,
    });
    const resumed: string[] = [];
    await requestTranslation(stage.uploadId, input);
    await translateRevision(job.id!, {
      translate: async (parts) => {
        resumed.push(...parts.map((p) => p.ref));
        return translate(parts);
      },
    });
    expect(resumed).toHaveLength(19);
    expect(resumed.some((ref) => ref.startsWith(stage.primitives[0].id))).toBe(
      false,
    );
    expect(await getTranslation(stage.uploadId, input)).toMatchObject({
      state: 'ready',
      completedSegments: 35,
    });
  },
);

check(
  'corrections and target languages have independent caches, and another upload cannot read or request them',
  async () => {
    const stage = await fixture(),
      other = await fixture();
    const input = { revisionId: stage.id, language: 'en' };
    const first = await requestTranslation(stage.uploadId, input);
    await translateRevision(first.id!, { translate });
    const corrected = await correctStage(stage.uploadId, {
      baseRevisionId: stage.id,
      label: stage.metadata.label,
      sourceTime: null,
      edits: [
        {
          primitiveId: stage.primitives[0].id,
          text: 'Corrected research observation',
          speaker: 'S01',
        },
      ],
    });
    expect(
      (
        await getTranslation(stage.uploadId, {
          ...input,
          revisionId: corrected.id,
        })
      ).state,
    ).toBe('not_requested');
    expect(
      (await getTranslation(stage.uploadId, { ...input, language: 'zh-TW' }))
        .state,
    ).toBe('not_requested');
    expect((await getTranslation(stage.uploadId, input)).state).toBe('ready');
    await expect(getTranslation(other.uploadId, input)).rejects.toThrow(
      'Revision not found',
    );
    await expect(requestTranslation(other.uploadId, input)).rejects.toThrow(
      'Revision not found',
    );
  },
);

check(
  'queue insertion replay deduplicates, and a manual failed retry gets a fresh queue generation',
  async () => {
    const stage = await fixture(),
      input = { revisionId: stage.id, language: 'en' };
    const requested = await requestTranslation(stage.uploadId, input);
    const boss = await startTranslationQueue();
    try {
      await dispatchTranslations(boss);
      await db
        .update(translationOutbox)
        .set({ dispatchedAt: null })
        .where(eq(translationOutbox.id, requested.id!));
      await dispatchTranslations(boss);
      const queueId = stableId(requested.id!, 'translation-queue', '0');
      const [rows] =
        await sqlClient`select count(*)::int as count from pgboss.job where id=${queueId}::uuid`;
      expect(rows.count).toBe(1);
      expect((await boss.getJobById(translationQueue, queueId))?.data).toEqual({
        translationId: requested.id,
      });
      await db
        .update(translationJobs)
        .set({ state: 'failed' })
        .where(eq(translationJobs.id, requested.id!));
      await requestTranslation(stage.uploadId, input);
      await dispatchTranslations(boss);
      expect(
        await boss.getJobById(
          translationQueue,
          stableId(requested.id!, 'translation-queue', '1'),
        ),
      ).not.toBeNull();
    } finally {
      await boss.stop({ graceful: true });
    }
  },
);

check(
  'separate worker consumes durable translations and shuts down without the ingestion worker',
  async () => {
    const stage = await fixture(2),
      input = { revisionId: stage.id, language: 'en' };
    const requested = await requestTranslation(stage.uploadId, input);
    const queue = await startTranslationQueue();
    try {
      await dispatchTranslations(queue);
      // This smoke should not wait behind recovery fixtures from earlier cases.
      await queue.update(translationQueue, undefined, {
        id: stableId(requested.id!, 'translation-queue', '0'),
        priority: 100,
      });
    } finally {
      await queue.stop({ graceful: true });
    }
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = (await request.json()) as {
          messages: { role: string; content: string }[];
        };
        const payload = JSON.parse(
          body.messages.find((message) => message.role === 'user')!.content,
        ) as { segments: { ref: string; text: string }[] };
        return Response.json({
          id: 'translation-regression',
          object: 'chat.completion',
          created: 1,
          model: 'qwen-regression',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  translations: payload.segments.map((part) => ({
                    ref: part.ref,
                    text: `Worker translated: ${part.text}`,
                  })),
                }),
              },
            },
          ],
        });
      },
    });
    const worker = Bun.spawn(['bun', 'apps/web/workers/translate.ts'], {
      cwd: '/app',
      env: {
        ...process.env,
        OPENAI_API_KEY: 'isolated-test-key',
        OPENAI_MODEL: 'qwen-regression',
        OPENAI_BASE_URL: `http://127.0.0.1:${server.port}/v1`,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const until = Date.now() + 20000;
      let current = await getTranslation(stage.uploadId, input);
      while (current.state !== 'ready' && Date.now() < until) {
        await Bun.sleep(100);
        current = await getTranslation(stage.uploadId, input);
      }
      expect(current).toMatchObject({
        id: requested.id,
        state: 'ready',
        completedSegments: 2,
        model: 'qwen-regression',
      });
      expect(
        current.translations.every((part) =>
          part.text.startsWith('Worker translated:'),
        ),
      ).toBe(true);
    } finally {
      worker.kill('SIGTERM');
      expect(await worker.exited).toBe(0);
      server.stop(true);
      const stderr = await new Response(worker.stderr).text();
      expect(stderr).toBe('');
    }
  },
  40000,
);
