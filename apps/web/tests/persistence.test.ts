import { correctStage } from '../src/lib/server/services/staging';
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
  memoryCount,
  retryUpload,
} from '../src/lib/server/services/uploads';
import { interpret } from '../src/lib/server/agents/interpreter';
import {
  startQueue,
  dispatchPending,
  queueName,
} from '../src/lib/server/jobs/queue';
import { assetPath } from '../src/lib/server/storage';
const enabled = !!process.env.DATABASE_URL;
const check = test.skipIf(!enabled);
const created: string[] = [];
afterAll(async () => {
  if (enabled) await sqlClient.end();
});
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
    const source = `Foundation regression ${crypto.randomUUID()}\nFriday launch.`;
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
          text: 'Existing reviewed speech',
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
          text: 'Later correction',
          speaker: 'S01',
        },
      ],
    });
    expect(corrected.speakerSuggestions).toEqual([]);
    expect(corrected.context?.readSegments).toBe(0);
    expect(corrected.context?.questions[0].status).toBe('unresolved');
    await interpret(runId); // No model credentials in regression containers: speech survives a visible context failure.
    const ready = await getUpload(item.uploadId);
    expect(ready.upload.currentRevisionId).toBe(corrected.id);
    expect(
      ready.revisions.find((r) => r.id === ready.run.revisionId)?.manifest
        .primitives[0],
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
    expect(latest.primitives[0]).toMatchObject({ text: 'Later correction' });
    expect(latest.provenance.transcription?.runId).toBe(item.runId);
    expect(await memoryCount()).toBe(0);
  },
);
