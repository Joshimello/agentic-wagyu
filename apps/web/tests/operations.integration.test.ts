import { test, expect, afterAll } from 'bun:test';
import { sqlClient } from '../src/lib/server/db/client';
import {
  acceptUpload,
  cancelUpload,
  getUpload,
  retryUpload,
} from '../src/lib/server/services/uploads';
import {
  createPush,
  cancelPush,
  retryPush,
  getPush,
} from '../src/lib/server/services/pushes';
import { interpret } from '../src/lib/server/agents/interpreter';
import { chronicle } from '../src/lib/server/agents/chronicler';
import {
  recoverInterrupted,
  withOperation,
} from '../src/lib/server/jobs/operation';
import {
  startQueue,
  dispatchPending,
  queueName,
  dispatchPushes,
  chroniclerQueue,
} from '../src/lib/server/jobs/queue';
import { llmClient } from '../src/lib/server/llm/client';
import type { Plan } from '../src/lib/server/contracts/memory';
const enabled = process.env.TEST_SUITE === 'operations',
  check = test.skipIf(!enabled);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});
const source = () =>
  acceptUpload(new File(['A durable local research note.'], 'note.txt'), {});

check(
  'canceling a queued push and retrying creates a fresh delivery with the same pinned input',
  async () => {
    const accepted = await source();
    await interpret(accepted.runId);
    const stage = (await getUpload(accepted.uploadId)).revisions[0].manifest;
    const batch = await createPush({
      idempotencyKey: crypto.randomUUID(),
      items: [
        {
          uploadId: stage.uploadId,
          revisionId: stage.id,
          acceptPartial: false,
        },
      ],
    });
    const boss = await startQueue();
    try {
      await dispatchPushes(boss);
      const [first] = await boss.fetch(chroniclerQueue);
      expect(first).toBeDefined();
      await cancelPush(batch.id);
      await boss.complete(chroniclerQueue, first.id);
      await retryPush(batch.id);
      await dispatchPushes(boss);
      const [next] = await boss.fetch(chroniclerQueue);
      expect(next.id).not.toBe(first.id);
      expect((await getPush(batch.id)).input).toEqual(batch.input);
      await cancelPush(batch.id);
    } finally {
      await boss.stop();
    }
  },
  30000,
);

check(
  'process death releases the lease; recovery delivers a fresh job without duplicate revisions',
  async () => {
    const accepted = await source(),
      boss = await startQueue();
    try {
      await dispatchPending(boss);
      const [first] = await boss.fetch(queueName);
      expect(first).toBeDefined();
      const child = Bun.spawn(
        [
          'bun',
          '-e',
          `
      import {sqlClient} from './apps/web/src/lib/server/db/client';
      import {leasedOperation} from './apps/web/src/lib/server/jobs/operation';
      await leasedOperation('interpret', '${accepted.runId}', async () => {
        await sqlClient\`update interpretation_runs set state='processing', attempts=1 where id='${accepted.runId}'\`;
        console.log('leased'); await new Promise(() => {});
      });
    `,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const reader = child.stdout.getReader();
      try {
        const ready = await reader.read();
        expect(new TextDecoder().decode(ready.value)).toContain('leased');
        expect(await recoverInterrupted()).toBe(0);
        child.kill('SIGKILL');
        await child.exited;
      } finally {
        reader.releaseLock();
        child.kill();
      }
      expect(await recoverInterrupted()).toBe(1);
      await dispatchPending(boss);
      const [second] = await boss.fetch(queueName);
      expect(second.id).not.toBe(first.id);
      await interpret(accepted.runId);
      await interpret(accepted.runId);
      const detail = await getUpload(accepted.uploadId);
      expect(detail.revisions).toHaveLength(1);
      expect(detail.run.state).toBe('ready');
      expect(detail.run.attempts).toBe(2);
    } finally {
      await boss.stop();
    }
  },
  30000,
);

check(
  'canceled interpretation preserves raw evidence, cannot publish, and can be retried',
  async () => {
    const accepted = await source();
    await cancelUpload(accepted.uploadId);
    await interpret(accepted.runId);
    expect((await getUpload(accepted.uploadId)).revisions).toHaveLength(0);
    const retry = await retryUpload(accepted.uploadId);
    await interpret(retry);
    const detail = await getUpload(accepted.uploadId);
    expect(detail.run.state).toBe('ready');
    expect(detail.revisions).toHaveLength(1);
  },
);

check(
  'cancellation during reconciliation cannot commit; retry retains pins and commits once',
  async () => {
    const accepted = await source();
    await interpret(accepted.runId);
    const stage = (await getUpload(accepted.uploadId)).revisions[0].manifest;
    const batch = await createPush({
      idempotencyKey: crypto.randomUUID(),
      workflow: 'assertions',
      items: [
        {
          uploadId: stage.uploadId,
          revisionId: stage.id,
          acceptPartial: false,
        },
      ],
    });
    const makePlan = (baseVersion: number): Plan => ({
      baseVersion,
      projects: [],
      entities: [],
      statements: [],
      versions: [],
      relations: [],
      model: 'regression',
      promptVersion: 'regression',
      outcomes: [
        {
          uploadId: stage.uploadId,
          revisionId: stage.id,
          disposition: 'no_assertions',
          assertions: 0,
          warnings: [],
        },
      ],
    });
    await expect(
      chronicle(batch.id, {
        buildPlan: async (_id, _input, _stages, snapshot) => {
          await cancelPush(batch.id);
          return makePlan(snapshot.version);
        },
      }),
    ).resolves.toBeDefined();
    expect((await getPush(batch.id)).state).toBe('canceled');
    expect(
      (await sqlClient`select * from memory_commits where push_id=${batch.id}`)
        .length,
    ).toBe(0);
    await retryPush(batch.id);
    await chronicle(batch.id, {
      buildPlan: async (_id, _input, _stages, snapshot) =>
        makePlan(snapshot.version),
    });
    await chronicle(batch.id);
    expect((await getPush(batch.id)).state).toBe('committed');
    expect(
      (await sqlClient`select * from memory_commits where push_id=${batch.id}`)
        .length,
    ).toBe(1);
  },
);

check(
  'concurrent preflight reservations enforce budgets across retries without leaking request text',
  async () => {
    process.env.LLM_MAX_CALLS_PER_OPERATION = '1';
    process.env.OPENAI_API_KEY = 'regression-only';
    process.env.OPENAI_MODEL = 'regression';
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        calls++;
        return Response.json({
          id: 'test',
          object: 'chat.completion',
          created: 1,
          model: 'regression',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'ok' },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        });
      },
    });
    process.env.OPENAI_BASE_URL = `http://localhost:${server.port}/v1`;
    const id = crypto.randomUUID(),
      { client, model } = llmClient();
    const request = () =>
      withOperation({ kind: 'regression', id }, () =>
        client.chat.completions.create({
          model,
          max_tokens: 20,
          messages: [
            { role: 'user', content: 'PrivatePromptMustNotAppearInLedger' },
          ],
        }),
      );
    try {
      const result = await Promise.allSettled([request(), request()]);
      expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(calls).toBe(1);
      await expect(request()).rejects.toThrow();
      expect(calls).toBe(1);
      const [row] =
        await sqlClient`select * from model_requests where operation_id=${id}`;
      expect(row.input_tokens).toBe(10);
      expect(row.output_tokens).toBe(2);
      expect(JSON.stringify(row)).not.toContain('PrivatePrompt');
      expect(row.cost_usd).toBeNull();
    } finally {
      server.stop(true);
      delete process.env.LLM_MAX_CALLS_PER_OPERATION;
    }
  },
  30000,
);

check(
  'unknown provider usage stays conservatively charged and a daily ceiling prevents dispatch',
  async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        calls++;
        return Response.json({
          id: 'test',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'ok' },
            },
          ],
        });
      },
    });
    process.env.OPENAI_BASE_URL = `http://localhost:${server.port}/v1`;
    const id = crypto.randomUUID(),
      { client, model } = llmClient();
    const request = () =>
      withOperation({ kind: 'regression', id }, () =>
        client.chat.completions.create({
          model,
          max_tokens: 20,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      );
    try {
      await request();
      const [row] =
        await sqlClient`select * from model_requests where operation_id=${id}`;
      expect(row.state).toBe('unknown');
      expect(row.input_tokens).toBeNull();
      expect(row.estimated_input).toBeGreaterThan(0);
      expect(row.reserved_output).toBe(20);
      process.env.LLM_DAILY_TOKEN_LIMIT = '1';
      await expect(request()).rejects.toThrow();
      expect(calls).toBe(1);
    } finally {
      server.stop(true);
      delete process.env.LLM_DAILY_TOKEN_LIMIT;
    }
  },
  30000,
);
