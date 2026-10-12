import {
  correctStage,
  exportMarkdown,
} from '../src/lib/server/services/staging';
import { validateStage, type Stage } from '../src/lib/server/contracts';
import { getProcessingDetails } from '../src/lib/server/services/processing';
import { MediaRequestError } from '../src/lib/server/agents/interpreter/media-client';
import { afterAll, test, expect } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db, sqlClient } from '../src/lib/server/db/client';
import {
  assets,
  uploads,
  runs,
  outbox,
  revisions,
} from '../src/lib/server/db/schema';
import {
  acceptUpload,
  getUpload,
  listUploads,
  memoryCount,
  retryUpload,
  cancelUploadRun,
} from '../src/lib/server/services/uploads';
import { interpret } from '../src/lib/server/agents/interpreter';
import {
  startQueue,
  dispatchPending,
  queueName,
} from '../src/lib/server/jobs/queue';
import { assetPath } from '../src/lib/server/storage';
import { updateSourceDetails, listSourceProjectNames } from '../src/lib/server/services/source-details';
import { selectRevision, listSelections } from '../src/lib/server/services/selections';
import { sourceProjectName } from '../src/lib/source-organization';
const enabled = process.env.TEST_SUITE === 'staging';
const check = test.skipIf(!enabled);
const created: string[] = [];
afterAll(async () => {
  if (enabled) await sqlClient.end();
});
const detailsInput = (source: Awaited<ReturnType<typeof getUpload>>) => ({
  baseRevisionId: source.upload.currentRevisionId,
  previous: { label: source.upload.metadata.label, sourceTime: source.upload.metadata.sourceTime,
    projectName: sourceProjectName(source.upload.metadata) },
  label: source.upload.metadata.label,
  sourceTime: source.upload.metadata.sourceTime,
  projectName: sourceProjectName(source.upload.metadata),
});

check('source details preserve evidence, earlier revisions, and pinned selections while updating the list', async () => {
  const item = await acceptUpload(new File(['Original meeting notes'], 'original.txt'), { groupHint: 'Uploaded together' });
  await interpret(item.runId);
  const before = await getUpload(item.uploadId);
  const original = before.revisions[0].manifest;
  await selectRevision({ uploadId: item.uploadId, revisionId: original.id });
  const memories = await memoryCount();
  await updateSourceDetails(item.uploadId, { ...detailsInput(before), label: 'Planning meeting',
    sourceTime: '2026-09-23T02:00:00.000Z', projectName: 'Agentic AI' });
  const after = await getUpload(item.uploadId);
  const current = after.revisions.find((revision) => revision.id === after.upload.currentRevisionId)!.manifest;
  expect(after.upload.filename).toBe('original.txt');
  expect(after.asset).toEqual(before.asset);
  expect(current.primitives).toEqual(original.primitives);
  expect(current.annotations).toEqual(original.annotations);
  expect(current.provenance).toEqual(original.provenance);
  expect(current.metadata).toMatchObject({ label: 'Planning meeting', groupHint: 'Agentic AI',
    sourceTime: '2026-09-23T02:00:00.000Z', sourceTimeOrigin: 'user' });
  expect(after.revisions.find((revision) => revision.id === original.id)!.manifest).toEqual(original);
  expect((await listSelections()).find((selection) => selection.uploadId === item.uploadId)).toMatchObject({
    revisionId: original.id, stale: true, metadata: original.metadata,
  });
  expect((await listUploads()).find((source) => source.id === item.uploadId)!.metadata).toEqual(current.metadata);
  expect(await listSourceProjectNames()).toContain('Agentic AI');
  expect(await memoryCount()).toBe(memories);
  await expect(updateSourceDetails(item.uploadId, detailsInput(before))).rejects.toThrow('details changed');
  const count = after.revisions.length;
  await updateSourceDetails(item.uploadId, detailsInput(after));
  expect((await getUpload(item.uploadId)).revisions).toHaveLength(count);
  const corrected = await correctStage(item.uploadId, { baseRevisionId: current.id, label: 'Updated title',
    sourceTime: null, edits: [] });
  expect((await listUploads()).find((source) => source.id === item.uploadId)!.metadata).toEqual(corrected.metadata);
});

check('failed sources can be organized before transcription and concurrent edits do not overwrite one another', async () => {
  const item = await acceptUpload(new File(['Raw preserved bytes'], 'failed.mp4'), {});
  const queued = await getUpload(item.uploadId);
  await expect(updateSourceDetails(item.uploadId, detailsInput(queued))).rejects.toThrow('processing to finish');
  await db.update(runs).set({ state: 'failed' }).where(eq(runs.id, item.runId));
  const before = await getUpload(item.uploadId);
  const results = await Promise.allSettled([
    updateSourceDetails(item.uploadId, { ...detailsInput(before), label: 'First edit', projectName: 'Review A' }),
    updateSourceDetails(item.uploadId, { ...detailsInput(before), label: 'Second edit', projectName: 'Review B' }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const after = await getUpload(item.uploadId);
  expect(after.revisions).toHaveLength(0);
  expect(after.upload.currentRevisionId).toBeNull();
  expect(after.asset).toEqual(before.asset);
  expect(await Bun.file(assetPath(after.asset.storageKey)).text()).toBe('Raw preserved bytes');
  await updateSourceDetails(item.uploadId, { ...detailsInput(after), projectName: '' });
  expect(sourceProjectName((await getUpload(item.uploadId)).upload.metadata)).toBe('');
});

check('a worker claiming the failed run wins before metadata can overwrite its processing input', async () => {
  const item = await acceptUpload(new File(['Untouched retry source'], 'retry-details.mp4'), {});
  await db.update(runs).set({ state: 'failed' }).where(eq(runs.id, item.runId));
  const before = await getUpload(item.uploadId);
  let pending: Promise<string | Error>;
  await db.transaction(async (worker) => {
    await worker.select().from(runs).where(eq(runs.id, item.runId)).for('update');
    pending = updateSourceDetails(item.uploadId, { ...detailsInput(before), label: 'Concurrent edit' })
      .catch((error: Error) => error);
    await Bun.sleep(100);
    await worker.update(runs).set({ state: 'processing' }).where(eq(runs.id, item.runId));
  });
  const result = await pending!;
  expect(result).toBeInstanceOf(Error);
  expect((result as Error).message).toContain('processing to finish');
  expect((await getUpload(item.uploadId)).upload.metadata).toEqual(before.upload.metadata);
});
check(
  'concurrent cancellation of eight failed queued retries does not exhaust the transaction pool',
  async () => {
    const boss = await startQueue();
    const deliveries: string[] = [];
    const items: { uploadId: string; runId: string }[] = [];
    try {
      for (let index = 0; index < 8; index++) {
        const item = await acceptUpload(
          new File(
            [`private cancellation fixture ${crypto.randomUUID()}`],
            'retry.mp4',
          ),
          {},
        );
        items.push(item);
        await db
          .update(runs)
          .set({ state: 'failed', attempts: 1 })
          .where(eq(runs.id, item.runId));
        const deliveryId = crypto.randomUUID();
        deliveries.push(deliveryId);
        await boss.send(queueName, { runId: item.runId }, { id: deliveryId });
        await sqlClient`update pgboss.job set state='retry',start_after=now()+interval '1 hour' where id=${deliveryId}`;
      }
      const canceled = await Promise.all(
        items.map((item) => cancelUploadRun(item.uploadId, item.runId)),
      );
      expect(canceled.map((run) => run.state)).toEqual(
        Array(8).fill('canceled'),
      );
    } finally {
      for (const deliveryId of deliveries)
        await sqlClient`delete from pgboss.job where id=${deliveryId}`;
      await boss.stop({ graceful: true });
    }
  },
  15000,
);
check(
  'a delayed automatic retry stays observable and prevents duplicate manual processing',
  async () => {
    const item = await acceptUpload(
      new File(['private retry fixture'], 'pending.mp4'),
      {},
    );
    const boss = await startQueue();
    const deliveryId = crypto.randomUUID();
    try {
      await db
        .update(runs)
        .set({
          state: 'failed',
          attempts: 1,
          updatedAt: new Date(Date.now() - 10 * 60000),
          error: 'Temporary service failure',
        })
        .where(eq(runs.id, item.runId));
      await boss.send(queueName, { runId: item.runId }, { id: deliveryId });
      await sqlClient`update pgboss.job set state='retry',start_after=now()+interval '1 hour' where id=${deliveryId}`;
      expect((await getUpload(item.uploadId)).run.retryPending).toBe(true);
      expect(
        (await getProcessingDetails(item.uploadId)).runs[0].retryPending,
      ).toBe(true);
      await expect(retryUpload(item.uploadId)).rejects.toThrow(
        'automatic retry is already queued',
      );
      await sqlClient`update pgboss.job set state='failed' where id=${deliveryId}`;
      expect((await getUpload(item.uploadId)).run.retryPending).toBe(false);
      expect(
        (await getProcessingDetails(item.uploadId)).runs[0].retryPending,
      ).toBe(false);
      await sqlClient`update pgboss.job set state='retry' where id=${deliveryId}`;
      expect((await cancelUploadRun(item.uploadId, item.runId)).state).toBe(
        'canceled',
      );
      await interpret(item.runId);
      expect((await getUpload(item.uploadId)).run.state).toBe('canceled');
      expect(
        (await getProcessingDetails(item.uploadId)).runs[0].retryPending,
      ).toBe(false);
    } finally {
      await sqlClient`delete from pgboss.job where id=${deliveryId}`;
      await boss.stop({ graceful: true });
    }
  },
);
check(
  'failed processing exposes its stage and redacted error, and retries retain attempt history without admitting evidence',
  async () => {
    const item = await acceptUpload(
      new File(['private lifecycle bytes'], 'failure.mp4'),
      {},
    );
    await expect(
      interpret(item.runId, {
        buildVideo: async (_stage, _key, _run, progress) => {
          await progress('Transcribing audio window 1/2 with local MOSS', 15);
          throw new MediaRequestError(
            'Model request timed out token=private-diagnostic-token',
            'transcribe',
            'media_timeout',
            true,
          );
        },
      }),
    ).rejects.toThrow('timed out');
    const failed = await getUpload(item.uploadId);
    expect(failed.run.error).toContain('timed out');
    expect(failed.run.error).not.toContain('private-diagnostic-token');
    const first = await getProcessingDetails(item.uploadId);
    expect(first.failure).toMatchObject({
      code: 'media_timeout',
      retryable: true,
    });
    expect(first.events.at(-1)).toMatchObject({
      phase: 'Transcribing audio window 1/2 with local MOSS',
      attempt: 1,
    });
    expect(JSON.stringify(first)).not.toContain('private-diagnostic-token');
    await interpret(item.runId, {
      buildVideo: async (stage, _key, _run, progress) => {
        await progress('Reusing saved audio window 1/2', 35);
        return stage;
      },
    });
    const recovered = await getProcessingDetails(item.uploadId);
    expect(recovered.runs[0]).toMatchObject({
      state: 'ready',
      attempts: 2,
      error: null,
      progressPercent: 100,
    });
    expect(
      recovered.events.some(
        (event) => event.attempt === 1 && event.level === 'error',
      ),
    ).toBe(true);
    expect(recovered.events.at(-1)).toMatchObject({ attempt: 2, percent: 100 });
    const other = await acceptUpload(
      new File(['another private source'], 'other.txt'),
      {},
    );
    await expect(
      getProcessingDetails(item.uploadId, other.runId),
    ).rejects.toThrow('not found for this upload');
    expect(await memoryCount()).toBe(0);
  },
);
check(
  'speaker review saves scoped names, original labels and decisions in immutable correction history',
  async () => {
    const item = await acceptUpload(
      new File(['private speaker review fixture'], 'speakers.mp4'),
      {},
    );
    const detail = await getUpload(item.uploadId);
    const stage: Stage = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      uploadId: item.uploadId,
      rawAssetId: detail.asset.id,
      parentRevisionId: null,
      createdAt: new Date().toISOString(),
      metadata: detail.upload.metadata,
      primitives: ['Part 1 · S01', 'Part 1 · S01', 'Part 2 · S01'].map(
        (speaker, index) => ({
          id: crypto.randomUUID(),
          kind: 'text',
          role: 'asr',
          speaker,
          text: `Original turn ${index + 1}`,
          locator: {
            kind: 'media',
            timeline: 'container',
            startMs: index * 1000,
            endMs: (index + 1) * 1000,
          },
        }),
      ),
      annotations: [],
      coverage: { complete: true, durationMs: 3000, warnings: [] },
      provenance: {
        adapter: 'video',
        model: 'MOSS',
        modelRevision: 'pinned',
        promptVersion: null,
      },
    };
    stage.speakerSuggestions = [0, 2].map((index) => ({
      id: crypto.randomUUID(),
      speaker: index === 0 ? 'Part 1 · S01' : 'Part 2 · S01',
      candidateName: index === 0 ? 'Alice' : 'Bob',
      confidence: 'medium',
      basis: 'self_introduction',
      reason: 'Explicit introduction in this turn.',
      transcriptIds: [stage.primitives[index].id],
      frameIds: [],
      model: 'test-model',
      promptVersion: 'test-prompt',
    }));
    await db.insert(revisions).values({
      id: stage.id,
      uploadId: item.uploadId,
      runId: item.runId,
      manifest: validateStage(stage),
    });
    await db
      .update(uploads)
      .set({ currentRevisionId: stage.id })
      .where(eq(uploads.id, item.uploadId));
    await db
      .update(runs)
      .set({ state: 'ready', revisionId: stage.id })
      .where(eq(runs.id, item.runId));
    const input = {
      baseRevisionId: stage.id,
      label: stage.metadata.label,
      sourceTime: null,
      edits: stage.primitives.slice(0, 2).map((p) => ({
        primitiveId: p.id,
        text: p.kind === 'text' ? p.text : '',
        speaker: ' Alice ',
      })),
      speakerReviews: [
        { suggestionId: stage.speakerSuggestions[0].id, decision: 'confirmed' },
        { suggestionId: stage.speakerSuggestions[1].id, decision: 'rejected' },
      ],
    };
    const corrected = await correctStage(item.uploadId, input);
    expect(corrected.parentRevisionId).toBe(stage.id);
    expect(corrected.primitives[0]).toMatchObject({
      speaker: 'Alice',
      originalSpeaker: 'Part 1 · S01',
      text: 'Original turn 1',
    });
    expect(corrected.primitives[1]).toMatchObject({
      speaker: 'Alice',
      originalSpeaker: 'Part 1 · S01',
    });
    expect(corrected.primitives[2]).toEqual(stage.primitives[2]);
    expect(corrected.speakerSuggestions?.map((s) => s.review)).toEqual([
      'confirmed',
      'rejected',
    ]);
    const markdown = exportMarkdown(
      corrected,
      'speakers.mp4',
      'http://localhost:5173',
    );
    expect(markdown).toContain('Original speaker label: Part 1 · S01');
    expect(markdown).toContain('User review: confirmed');
    expect(markdown).toContain('User review: rejected');
    await expect(correctStage(item.uploadId, input)).rejects.toThrow(
      'Staging changed',
    );
    const individual = await correctStage(item.uploadId, {
      ...input,
      baseRevisionId: corrected.id,
      edits: [
        {
          primitiveId: stage.primitives[0].id,
          text: 'Original turn 1',
          speaker: 'Carol',
        },
      ],
      speakerReviews: [],
    });
    expect(individual.primitives[0]).toMatchObject({
      speaker: 'Carol',
      originalSpeaker: 'Part 1 · S01',
    });
    expect(individual.primitives[1]).toMatchObject({
      speaker: 'Alice',
      originalSpeaker: 'Part 1 · S01',
    });
    expect(individual.speakerSuggestions?.map((s) => s.review)).toEqual([
      'rejected',
    ]);
    const history = await getUpload(item.uploadId);
    expect(history.revisions).toHaveLength(3);
    expect(history.revisions.find((r) => r.id === stage.id)?.manifest).toEqual(
      stage,
    );
    expect(await memoryCount()).toBe(0);
    await expect(
      correctStage(item.uploadId, {
        ...input,
        baseRevisionId: individual.id,
        edits: [],
        speakerReviews: [
          { suggestionId: crypto.randomUUID(), decision: 'rejected' },
        ],
      }),
    ).rejects.toThrow('no longer available');
    expect((await getUpload(item.uploadId)).revisions).toHaveLength(3);
  },
);
check(
  'database migration installs pgvector and durable application tables',
  async () => {
    const [ext] =
      await sqlClient`select extversion from pg_extension where extname='vector'`;
    expect(ext.extversion).toBe('0.8.2');
    const [tables] =
      await sqlClient`select count(*)::int as count from information_schema.tables where table_schema='public' and table_name in ('assets','uploads','interpretation_runs','job_outbox','staging_revisions','memory_commits')`;
    expect(tables.count).toBe(6);
  },
);
check(
  'same immutable bytes keep distinct submission context and preserve source',
  async () => {
    const source = `Staging regression ${crypto.randomUUID()}\nFriday launch.`;
    const a = await acceptUpload(
      new File([source], 'notes.txt', { type: 'text/plain' }),
      { uploader: 'Alice', label: 'Meeting A' },
    );
    const b = await acceptUpload(
      new File([source], 'notes.txt', { type: 'text/plain' }),
      { uploader: 'Bob', label: 'Meeting B' },
    );
    created.push(a.uploadId, b.uploadId);
    const first = await getUpload(a.uploadId),
      second = await getUpload(b.uploadId);
    expect(first.asset.id).toBe(second.asset.id);
    expect(first.upload.metadata.uploader).toBe('Alice');
    expect(second.upload.metadata.uploader).toBe('Bob');
    expect(await Bun.file(assetPath(first.asset.storageKey)).text()).toBe(
      source,
    );
    await Promise.all([interpret(a.runId), interpret(a.runId)]);
    const done = await getUpload(a.uploadId);
    expect(done.revisions.length).toBe(1);
    expect(done.run.state).toBe('ready');
    expect(done.revisions[0].manifest.primitives[0].kind).toBe('text');
    expect(await memoryCount()).toBe(0);
  },
);
check(
  'unsupported source fails visibly, retains original, and can be retried',
  async () => {
    const item = await acceptUpload(
      new File(['unsupported'], 'unknown.bin'),
      {},
    );
    created.push(item.uploadId);
    await expect(interpret(item.runId)).rejects.toThrow('adapter');
    expect((await getUpload(item.uploadId)).run.state).toBe('failed');
    const retry = await retryUpload(item.uploadId);
    expect(retry).not.toBe(item.runId);
    const [pending] = await db
      .select()
      .from(outbox)
      .where(eq(outbox.id, retry));
    expect(pending.dispatchedAt).toBeNull();
  },
);
check(
  'process death after upload and replay around dispatch lose no accepted upload',
  async () => {
    const child = Bun.spawn(
      [
        'bun',
        '-e',
        `import {acceptUpload} from './apps/web/src/lib/server/services/uploads'; const item=await acceptUpload(new File(['Restart evidence'],'restart.txt'),{label:'Recovery check'}); console.log(JSON.stringify(item)); process.exit(0);`,
      ],
      { cwd: '/app', stdout: 'pipe', stderr: 'pipe' },
    );
    const item = JSON.parse((await new Response(child.stdout).text()).trim());
    expect(await child.exited).toBe(0);
    created.push(item.uploadId);
    const boss = await startQueue();
    try {
      // Simulate death after queue insertion but before the outbox acknowledgment.
      await boss.send(queueName, { runId: item.runId }, { id: item.runId });
      await dispatchPending(boss);
      await db
        .update(outbox)
        .set({ dispatchedAt: null })
        .where(eq(outbox.id, item.runId));
      await dispatchPending(boss);
      const [job] =
        await sqlClient`select count(*)::int as count from pgboss.job where id=${item.runId}::uuid`;
      expect(job.count).toBe(1);
      const process = Bun.spawn(['bun', 'apps/web/workers/run.ts'], {
        cwd: '/app',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      try {
        const until = Date.now() + 30000;
        let current = await getUpload(item.uploadId);
        while (current.run.state !== 'ready' && Date.now() < until) {
          await Bun.sleep(250);
          current = await getUpload(item.uploadId);
        }
        expect(current.run.state).toBe('ready');
      } finally {
        process.kill('SIGTERM');
        expect(await process.exited).toBe(0);
      }
      await interpret(item.runId);
      expect((await getUpload(item.uploadId)).revisions.length).toBe(1);
    } finally {
      await boss.stop({ graceful: true });
    }
  },
  60000,
);

check(
  'concurrent corrections preserve the original and reject stale edits',
  async () => {
    const accepted = await acceptUpload(
      new File(['Original speech'], 'correction.txt'),
      {},
    );
    await interpret(accepted.runId);
    const base = (await getUpload(accepted.uploadId)).revisions[0].manifest;
    const input = {
      baseRevisionId: base.id,
      label: 'Reviewed',
      sourceTime: null,
      edits: [
        {
          primitiveId: base.primitives[0].id,
          text: 'Corrected speech',
          speaker: 'Alice',
        },
      ],
    };
    const results = await Promise.allSettled([
      correctStage(accepted.uploadId, input),
      correctStage(accepted.uploadId, input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(results.filter((r) => r.status === 'rejected').length).toBe(1);
    const history = (await getUpload(accepted.uploadId)).revisions;
    expect(history.length).toBe(2);
    expect(
      history.find((r) => r.id === base.id)?.manifest.primitives[0],
    ).toMatchObject({ text: 'Original speech' });
    expect(await memoryCount()).toBe(0);
  },
);
check('simultaneous reprocess clicks enqueue one new run', async () => {
  const accepted = await acceptUpload(
    new File(['Single retry'], 'reprocess.txt'),
    {},
  );
  await interpret(accepted.runId);
  const results = await Promise.allSettled([
    retryUpload(accepted.uploadId),
    retryUpload(accepted.uploadId),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
  expect(results.filter((r) => r.status === 'rejected').length).toBe(1);
});

check(
  'visual review pins the current recording revision without rerunning ASR and preserves later corrections',
  async () => {
    const item = await acceptUpload(
      new File(['private temporary recording bytes'], 'context.mp4'),
      {},
    );
    const detail = await getUpload(item.uploadId);
    const base = {
      schemaVersion: 1 as const,
      id: crypto.randomUUID(),
      uploadId: item.uploadId,
      rawAssetId: detail.asset.id,
      parentRevisionId: null,
      createdAt: new Date().toISOString(),
      metadata: detail.upload.metadata,
      primitives: [
        {
          id: crypto.randomUUID(),
          kind: 'text' as const,
          role: 'asr' as const,
          speaker: 'S01',
          text: '现有已审阅的发言，里面包括资讯。',
          locator: {
            kind: 'media' as const,
            timeline: 'container' as const,
            startMs: 1000,
            endMs: 2000,
          },
        },
      ],
      annotations: [],
      coverage: { complete: true, durationMs: 3000, warnings: [] },
      provenance: {
        adapter: 'video',
        model: 'MOSS',
        modelRevision: 'pinned',
        promptVersion: null,
      },
    };
    const candidate = {
      id: crypto.randomUUID(),
      speaker: 'S01',
      candidateName: '小林',
      confidence: 'medium' as const,
      basis: 'self_introduction' as const,
      reason: 'Test of cited-name invalidation',
      transcriptIds: [base.primitives[0].id],
      frameIds: [],
      model: 'test-model',
      promptVersion: 'context-test',
    };
    const enriched = {
      ...base,
      speakerSuggestions: [candidate],
      context: {
        model: 'test-model',
        promptVersion: 'context-test',
        readSegments: 1,
        totalSegments: 1,
        questions: [
          {
            id: crypto.randomUUID(),
            question: 'Who introduced themselves?',
            purpose: 'speaker_identity' as const,
            transcriptIds: [base.primitives[0].id],
            status: 'answered' as const,
            explanation: '',
            searches: [],
          },
        ],
      },
    };
    await db.insert(revisions).values({
      id: base.id,
      uploadId: item.uploadId,
      runId: item.runId,
      manifest: enriched,
    });
    await db
      .update(uploads)
      .set({ currentRevisionId: base.id })
      .where(eq(uploads.id, item.uploadId));
    await db
      .update(runs)
      .set({ state: 'ready', revisionId: base.id })
      .where(eq(runs.id, item.runId));
    const result = await Promise.allSettled([
      retryUpload(item.uploadId, base.id),
      retryUpload(item.uploadId, base.id),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const runId = (
      result.find(
        (r) => r.status === 'fulfilled',
      ) as PromiseFulfilledResult<string>
    ).value;
    const corrected = await correctStage(item.uploadId, {
      baseRevisionId: base.id,
      label: 'Reviewed',
      sourceTime: null,
      edits: [
        {
          primitiveId: base.primitives[0].id,
          text: '后来修正的发言，里面包括资讯。',
          speaker: 'S01',
        },
      ],
    });
    expect(corrected.speakerSuggestions).toEqual([]);
    expect(corrected.primitives[0]).toMatchObject({
      text: '後來修正的發言，裏面包括資訊。',
      id: base.primitives[0].id,
      locator: base.primitives[0].locator,
      speaker: 'S01',
    });
    expect(corrected.context?.readSegments).toBe(0);
    expect(corrected.context?.questions[0].status).toBe('unresolved');
    await interpret(runId); // No model credentials in regression containers: speech survives a visible context failure.
    const ready = await getUpload(item.uploadId);
    expect(ready.upload.currentRevisionId).toBe(corrected.id);
    expect(
      ready.revisions.find((r) => r.id === ready.run.revisionId)?.manifest
        .primitives[0],
    ).toEqual({
      ...base.primitives[0],
      text: '現有已審閱的發言，裏面包括資訊。',
    });
    expect(
      ready.revisions.find((r) => r.id === base.id)?.manifest.primitives[0],
    ).toEqual(base.primitives[0]);
    expect(
      ready.revisions.find((r) => r.id === ready.run.revisionId)
        ?.parentRevisionId,
    ).toBe(base.id);
    expect(ready.run.inputRevisionId).toBe(base.id);
    await expect(retryUpload(item.uploadId, base.id)).rejects.toThrow(
      'Staging changed',
    );
    const correctedRun = await retryUpload(item.uploadId, corrected.id);
    await interpret(correctedRun);
    const reviewed = await getUpload(item.uploadId);
    const latest = reviewed.revisions.find(
      (r) => r.id === reviewed.upload.currentRevisionId,
    )!.manifest;
    expect(latest.primitives[0]).toMatchObject({
      text: '後來修正的發言，裏面包括資訊。',
    });
    expect(latest.provenance.textNormalization).toMatchObject({
      engine: 'opencc-js',
      conversion: 's2t',
    });
    expect(latest.provenance.transcription?.runId).toBe(item.runId);
    const unchanged = await correctStage(item.uploadId, {
      baseRevisionId: latest.id,
      label: latest.metadata.label,
      sourceTime: latest.metadata.sourceTime,
      edits: [
        {
          primitiveId: latest.primitives[0].id,
          text: '後來修正的發言，裏面包括資訊。',
          speaker: 'S01',
        },
      ],
    });
    expect(unchanged.primitives[0]).toEqual(latest.primitives[0]);
    expect(await memoryCount()).toBe(0);
  },
);

check(
  'grouped uploads publish together, preserve raw deduplication and reject an invalid batch atomically',
  async () => {
    const { acceptUploadBatch } =
      await import('../src/lib/server/services/uploads');
    const batch = await acceptUploadBatch(
      [
        new File(['Grouped source'], 'one.txt'),
        new File(['Grouped source'], 'two.txt'),
      ],
      { groupHint: 'Meeting and slides' },
    );
    const [a, b] = await Promise.all(
      batch.map((item) => getUpload(item.uploadId)),
    );
    expect(a.upload.metadata.groupId).toBe(b.upload.metadata.groupId);
    expect(a.upload.metadata.groupHint).toBe('Meeting and slides');
    expect(a.asset.id).toBe(b.asset.id);
    const single = await acceptUpload(
      new File(['Single grouped source'], 'single.txt'),
      { groupHint: 'Project context' },
    );
    const singleDetail = await getUpload(single.uploadId);
    expect(singleDetail.upload.metadata.groupId).toBeDefined();
    expect(singleDetail.upload.metadata.groupHint).toBe('Project context');
    const [{ count: before }] =
      await sqlClient`select count(*)::int as count from uploads`;
    await expect(
      acceptUploadBatch(
        [new File(['valid'], 'valid.txt'), new File([], 'empty.txt')],
        {},
      ),
    ).rejects.toThrow();
    const [{ count: after }] =
      await sqlClient`select count(*)::int as count from uploads`;
    expect(after).toBe(before);
  },
);
check(
  'saved selections pin a video and deck revision across corrections; partial coverage requires explicit acceptance',
  async () => {
    const { selectRevision, listSelections, removeSelection } =
      await import('../src/lib/server/services/selections');
    const video = await acceptUpload(
      new File(['video raw evidence'], 'selection.mp4'),
      {},
    );
    const deck = await acceptUpload(
      new File(['deck raw evidence'], 'selection.pptx'),
      {},
    );
    const items = [];
    for (const item of [video, deck]) {
      const detail = await getUpload(item.uploadId);
      const primitive = {
        id: crypto.randomUUID(),
        kind: 'text' as const,
        role: 'native' as const,
        text: 'Original',
        speaker: null,
        locator: { kind: 'text' as const, start: 0, end: 8 },
      };
      const manifest = {
        schemaVersion: 1 as const,
        id: crypto.randomUUID(),
        uploadId: item.uploadId,
        rawAssetId: detail.asset.id,
        parentRevisionId: null,
        createdAt: new Date().toISOString(),
        metadata: detail.upload.metadata,
        primitives: [primitive],
        annotations: [],
        coverage: {
          complete: item === video,
          durationMs: null,
          warnings: item === video ? [] : ['Partial render'],
        },
        provenance: {
          adapter: 'test',
          model: null,
          modelRevision: null,
          promptVersion: null,
        },
      };
      await db.insert(revisions).values({
        id: manifest.id,
        uploadId: item.uploadId,
        runId: item.runId,
        manifest,
      });
      await db
        .update(uploads)
        .set({ currentRevisionId: manifest.id })
        .where(eq(uploads.id, item.uploadId));
      await db
        .update(runs)
        .set({ state: 'ready_with_warnings', revisionId: manifest.id })
        .where(eq(runs.id, item.runId));
      items.push(manifest);
      await selectRevision({
        uploadId: item.uploadId,
        revisionId: manifest.id,
        acceptPartial: false,
      });
    }
    const corrected = await correctStage(deck.uploadId, {
      baseRevisionId: items[1].id,
      label: 'Corrected deck',
      sourceTime: null,
      edits: [],
    });
    const selections = await listSelections();
    const pinned = selections.find((s) => s.uploadId === deck.uploadId)!;
    expect(pinned.revisionId).toBe(items[1].id);
    expect(pinned.currentRevisionId).toBe(corrected.id);
    expect(pinned.stale).toBe(true);
    expect(pinned.readyForPush).toBe(false);
    expect(pinned.metadata.label).toBe('selection.pptx');
    await selectRevision({
      uploadId: deck.uploadId,
      revisionId: items[1].id,
      acceptPartial: true,
    });
    expect(
      (await listSelections()).find((s) => s.uploadId === deck.uploadId)
        ?.readyForPush,
    ).toBe(true);
    await expect(
      selectRevision({ uploadId: video.uploadId, revisionId: corrected.id }),
    ).rejects.toThrow('belong');
    await selectRevision({
      uploadId: deck.uploadId,
      revisionId: corrected.id,
      acceptPartial: true,
    });
    expect(
      (await listSelections()).find((s) => s.uploadId === deck.uploadId)?.stale,
    ).toBe(false);
    await removeSelection(deck.uploadId);
    await removeSelection(video.uploadId);
    await expect(
      selectRevision({ uploadId: deck.uploadId, revisionId: items[1].id }),
    ).rejects.toThrow('changed');
    expect(await memoryCount()).toBe(0);
  },
);
