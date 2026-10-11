import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { db, sqlClient } from '../src/lib/server/db/client';
import {
  assets,
  uploads,
  runs,
  outbox,
  revisions,
  stagingSelections,
  translationJobs,
  translationOutbox,
  chroniclerOutbox,
} from '../src/lib/server/db/schema';
import {
  acceptUpload,
  getUpload,
  listUploads,
  retryUpload,
} from '../src/lib/server/services/uploads';
import { removeUploads } from '../src/lib/server/services/removal';
import {
  listSelections,
  selectRevision,
} from '../src/lib/server/services/selections';
import { correctStage } from '../src/lib/server/services/staging';
import {
  getTranslation,
  requestTranslation,
} from '../src/lib/server/services/translations';
import {
  createPush,
  getPush,
  retryPush,
} from '../src/lib/server/services/pushes';
import { interpret } from '../src/lib/server/agents/interpreter';
import { translateRevision } from '../src/lib/server/agents/translation';
import { chronicle } from '../src/lib/server/agents/chronicler';
import {
  evidenceView,
  memorySnapshot,
} from '../src/lib/server/services/memory';
import { dispatchPending, dispatchPushes } from '../src/lib/server/jobs/queue';
import { dispatchTranslations } from '../src/lib/server/jobs/translations';
import { assetPath } from '../src/lib/server/storage';
import type { Stage } from '../src/lib/server/contracts';
import type { llmClient } from '../src/lib/server/llm/client';

const enabled =
  process.env.REMOVAL_TEST_DATABASE === '1' ||
  process.env.TEST_SUITE === 'removal';
if (
  enabled &&
  (!/^chronicler_removal_test_/.test(
    new URL(process.env.DATABASE_URL!).pathname.slice(1),
  ) ||
    !(
      process.env.DATA_ROOT?.startsWith('/tmp/chronicler-removal') ||
      (process.env.TEST_SUITE === 'removal' &&
        process.env.DATA_ROOT?.startsWith('/data/tests/'))
    ))
)
  throw new Error(
    'Removal tests require their isolated database and temporary storage',
  );
const check = test.skipIf(!enabled);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});

async function source(
  text = `Research observation ${crypto.randomUUID()}`,
  filename = 'meeting-notes.txt',
) {
  const accepted = await acceptUpload(
    new File([text], filename, { type: 'text/plain' }),
    {},
  );
  if (/\.txt$/.test(filename)) await interpret(accepted.runId);
  return { ...accepted, text, details: await getUpload(accepted.uploadId) };
}

function push(stage: Stage) {
  return {
    idempotencyKey: crypto.randomUUID(),
    workflow: 'assertions',
    projectScope: { mode: 'auto' },
    items: [
      { uploadId: stage.uploadId, revisionId: stage.id, acceptPartial: false },
    ],
  };
}

check(
  'removal hides staging while keeping shared raw assets, pinned revisions and accepted memory readable',
  async () => {
    const first = await source(),
      shared = await source(first.text, 'second-copy.txt');
    const original = first.details.revisions[0].manifest;
    const corrected = await correctStage(first.uploadId, {
      baseRevisionId: original.id,
      label: original.metadata.label,
      sourceTime: null,
      edits: [
        {
          primitiveId: original.primitives[0].id,
          text: 'Corrected research observation',
          speaker: null,
        },
      ],
    });
    await selectRevision({
      uploadId: first.uploadId,
      revisionId: corrected.id,
    });
    const batch = await createPush(push(original));
    const committed = await chronicle(batch.id, {
      buildPlan: async (_id, _input, _stages, snapshot) => ({
        baseVersion: snapshot.version,
        model: 'removal-regression',
        promptVersion: 'removal-regression',
        projects: [],
        entities: [],
        statements: [],
        versions: [],
        relations: [],
        outcomes: [
          {
            uploadId: first.uploadId,
            revisionId: original.id,
            disposition: 'incorporated',
            assertions: 0,
            warnings: [],
          },
        ],
      }),
    });
    expect(committed!.state).toBe('committed');
    const memoryBefore = await memorySnapshot();
    const rawAssetId = first.details.asset.id;
    expect(shared.details.asset.id).toBe(rawAssetId);
    expect(await removeUploads({ uploadIds: [first.uploadId] })).toEqual({
      removedIds: [first.uploadId],
    });
    expect(
      (await listUploads()).some((item) => item.id === first.uploadId),
    ).toBe(false);
    expect(
      (await listUploads()).some((item) => item.id === shared.uploadId),
    ).toBe(true);
    expect(
      (await listSelections()).some((item) => item.uploadId === first.uploadId),
    ).toBe(false);
    const archived = await getUpload(first.uploadId);
    expect(archived.upload.deletedAt).not.toBeNull();
    expect(archived.upload.currentRevisionId).toBe(corrected.id);
    expect(archived.revisions.map((item) => item.id)).toContain(original.id);
    expect(archived.revisions.map((item) => item.id)).toContain(corrected.id);
    expect(await Bun.file(assetPath(archived.asset.storageKey)).text()).toBe(
      first.text,
    );
    expect(
      await db.select().from(assets).where(eq(assets.id, rawAssetId)),
    ).toHaveLength(1);
    expect(await memorySnapshot()).toEqual(memoryBefore);
    expect(
      await evidenceView(
        original.id,
        original.primitives[0].id,
        committed!.commitVersion!,
      ),
    ).toMatchObject({
      revisionId: original.id,
      rawAssetId,
      uploadId: first.uploadId,
    });
    expect(await getPush(batch.id)).toMatchObject({
      state: 'committed',
      commitVersion: committed!.commitVersion,
    });
    await removeUploads({ uploadIds: [first.uploadId] });
    expect((await getUpload(first.uploadId)).upload.deletedAt).toEqual(
      archived.upload.deletedAt,
    );
  },
);

check(
  'removed sources reject selections, corrections, retries, translations and new memory pushes',
  async () => {
    const item = await source(),
      stage = item.details.revisions[0].manifest;
    const pending = await createPush(push(stage));
    await selectRevision({ uploadId: item.uploadId, revisionId: stage.id });
    await removeUploads({ uploadIds: [item.uploadId] });
    await expect(
      selectRevision({ uploadId: item.uploadId, revisionId: stage.id }),
    ).rejects.toThrow('Revision does not belong');
    await expect(
      correctStage(item.uploadId, {
        baseRevisionId: stage.id,
        label: stage.metadata.label,
        sourceTime: null,
        edits: [],
      }),
    ).rejects.toThrow('Staging changed');
    await expect(retryUpload(item.uploadId)).rejects.toThrow(
      'Upload not found',
    );
    await expect(
      requestTranslation(item.uploadId, {
        revisionId: stage.id,
        language: 'en',
      }),
    ).rejects.toThrow('Upload not found');
    await expect(createPush(push(stage))).rejects.toThrow('removed');
    await expect(retryPush(pending.id)).rejects.toThrow('removed');
    expect(
      await db
        .select()
        .from(stagingSelections)
        .where(eq(stagingSelections.uploadId, item.uploadId)),
    ).toHaveLength(0);
  },
);

check(
  'queued unsupported sources can be removed without starting work, and invalid batches are atomic',
  async () => {
    const first = await source(
        'Unprocessed binary research evidence',
        'research.blob',
      ),
      second = await source('Second unprocessed source', 'scan.unknown');
    await expect(
      removeUploads({ uploadIds: [first.uploadId, crypto.randomUUID()] }),
    ).rejects.toThrow('no longer exist');
    expect((await getUpload(first.uploadId)).upload.deletedAt).toBeNull();
    expect((await getUpload(first.uploadId)).run.state).toBe('queued');
    await expect(
      removeUploads({ uploadIds: [first.uploadId, first.uploadId] }),
    ).rejects.toThrow('Choose each source');
    await removeUploads({ uploadIds: [first.uploadId, second.uploadId] });
    expect((await getUpload(first.uploadId)).run.state).toBe('canceled');
    expect((await getUpload(second.uploadId)).run.state).toBe('canceled');
    expect(
      (await db.select().from(outbox).where(eq(outbox.id, first.runId)))[0]
        .dispatchedAt,
    ).not.toBeNull();
    let called = false;
    await interpret(first.runId, {
      buildVideo: async (value) => {
        called = true;
        return value;
      },
    });
    expect(called).toBe(false);
    expect(
      await Bun.file(assetPath(first.details.asset.storageKey)).text(),
    ).toBe(first.text);
  },
);

check(
  'removal interrupts only the source active interpretation, translation and push and prevents durable redispatch',
  async () => {
    const item = await source(),
      other = await source('An unrelated source remains queued', 'other.blob');
    const stage = item.details.revisions[0].manifest;
    await db
      .update(uploads)
      .set({ filename: 'meeting.mp4' })
      .where(eq(uploads.id, item.uploadId));
    const runId = await retryUpload(item.uploadId),
      input = { revisionId: stage.id, language: 'en' };
    const translation = await requestTranslation(item.uploadId, input),
      batch = await createPush(push(stage));
    let interpreterStarted!: () => void,
      translatorStarted!: () => void,
      pushStarted!: () => void;
    const ready = [
      new Promise<void>((resolve) => {
        interpreterStarted = resolve;
      }),
      new Promise<void>((resolve) => {
        translatorStarted = resolve;
      }),
      new Promise<void>((resolve) => {
        pushStarted = resolve;
      }),
    ];
    const aborted = { interpreter: false, translation: false, push: false };
    const waitForAbort = (signal: AbortSignal, name: keyof typeof aborted) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted[name] = true;
            reject(new Error('Canceled active request'));
          },
          { once: true },
        );
      });
    const llm = {
      model: 'removal-active-model',
      client: {
        chat: {
          completions: {
            create: async (
              _input: unknown,
              options: { signal: AbortSignal },
            ) => {
              translatorStarted();
              return waitForAbort(options.signal, 'translation');
            },
          },
        },
      },
    } as unknown as ReturnType<typeof llmClient>;
    const canceledMedia: string[] = [],
      previousFetch = globalThis.fetch;
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (
        init?.method === 'POST' &&
        /\/jobs\/[^/]+\/cancel$/.test(String(url))
      ) {
        canceledMedia.push(String(url).split('/').at(-2)!);
        return Response.json({ canceled: true });
      }
      throw new Error('Removal test blocked an unexpected network request');
    }) as typeof fetch;
    const processing = [
      interpret(runId, {
        buildVideo: async (_value, _key, _id, progress, signal) => {
          await progress('Audio processing', 23);
          interpreterStarted();
          return waitForAbort(signal!, 'interpreter');
        },
      }),
      translateRevision(translation.id!, { llm }),
      chronicle(batch.id, {
        buildPlan: async (_id, _input, _stages, _snapshot, options) => {
          await options!.progress!('Reading memory evidence', 65);
          pushStarted();
          return waitForAbort(options!.signal!, 'push');
        },
      }),
    ];
    try {
      await Promise.all(ready);
      await removeUploads({ uploadIds: [item.uploadId] });
      await Promise.all(processing);
      expect(aborted).toEqual({
        interpreter: true,
        translation: true,
        push: true,
      });
      expect(canceledMedia).toContain(runId);
      expect(
        (await db.select().from(runs).where(eq(runs.id, runId)))[0],
      ).toMatchObject({
        state: 'canceled',
        progressPercent: 23,
        revisionId: null,
      });
      expect(await getTranslation(item.uploadId, input)).toMatchObject({
        state: 'canceled',
        completedSegments: 0,
      });
      expect(await getPush(batch.id)).toMatchObject({
        state: 'canceled',
        progressPercent: 65,
        generation: 1,
        commitVersion: null,
      });
      expect(
        (
          await db
            .select()
            .from(translationJobs)
            .where(eq(translationJobs.id, translation.id!))
        )[0].generation,
      ).toBe(1);
      expect((await getUpload(other.uploadId)).run.state).toBe('queued');
      expect((await getUpload(item.uploadId)).upload.currentRevisionId).toBe(
        stage.id,
      );
      expect(
        await db.select().from(revisions).where(eq(revisions.runId, runId)),
      ).toHaveLength(0);
      expect(
        (
          await db
            .select()
            .from(translationOutbox)
            .where(eq(translationOutbox.id, translation.id!))
        )[0].dispatchedAt,
      ).not.toBeNull();
      expect(
        (
          await db
            .select()
            .from(chroniclerOutbox)
            .where(eq(chroniclerOutbox.id, batch.id))
        )[0].dispatchedAt,
      ).not.toBeNull();
      const sent: string[] = [];
      const boss = {
        send: async (
          _queue: string,
          data: { runId?: string; translationId?: string; pushId?: string },
        ) => {
          sent.push(data.runId ?? data.translationId ?? data.pushId!);
          return crypto.randomUUID();
        },
      } as unknown as PgBoss;
      await dispatchPending(boss);
      await dispatchTranslations(boss);
      await dispatchPushes(boss);
      expect(sent).not.toContain(runId);
      expect(sent).not.toContain(translation.id!);
      expect(sent).not.toContain(batch.id);
    } finally {
      globalThis.fetch = previousFetch;
    }
  },
);
