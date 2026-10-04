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
