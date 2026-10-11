import { test, expect, afterAll } from 'bun:test';
import OpenAI from 'openai';
import { eq, sql } from 'drizzle-orm';
import { db, sqlClient } from '../src/lib/server/db/client';
import {
  memoryCommits,
  evidenceAdmissions,
  memoryNodes,
  memoryNodeVersions,
  researchRuns,
  researchOutbox,
} from '../src/lib/server/db/schema';
import { acceptUpload, getUpload } from '../src/lib/server/services/uploads';
import { interpret } from '../src/lib/server/agents/interpreter';
import { correctStage } from '../src/lib/server/services/staging';
import {
  createResearch,
  getResearch,
  loadResearchCorpus,
  cancelResearch,
  retryResearch,
} from '../src/lib/server/services/research';
import { research } from '../src/lib/server/agents/researcher';
import { memorySnapshot } from '../src/lib/server/services/memory';
import {
  startQueue,
  dispatchResearch,
  researchQueue,
  queueName,
} from '../src/lib/server/jobs/queue';
import type { Stage } from '../src/lib/server/contracts';
const enabled = process.env.RESEARCH_TEST === 'true',
  check = test.skipIf(!enabled);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});
let stage: Stage, projectId: string, segmentId: string, firstVersion: number;
async function source(text: string) {
  const accepted = await acceptUpload(
    new File([text], 'research-notes.txt', { type: 'text/plain' }),
    {},
  );
  await interpret(accepted.runId);
  return (await getUpload(accepted.uploadId)).revisions[0].manifest;
}
async function admit(stage: Stage, project?: string) {
  const version = (await memorySnapshot()).version + 1,
    root = project ?? crypto.randomUUID(),
    topic = crypto.randomUUID(),
    source = crypto.randomUUID(),
    segment = crypto.randomUUID();
  const nodes = [
    { id: root, kind: 'project' as const, scopeId: null, revisionId: null },
    { id: topic, kind: 'topic' as const, scopeId: root, revisionId: null },
    {
      id: source,
      kind: 'source' as const,
      scopeId: null,
      revisionId: stage.id,
    },
    {
      id: segment,
      kind: 'segment' as const,
      scopeId: source,
      revisionId: stage.id,
    },
  ];
  const ids = nodes.map(() => crypto.randomUUID());
  await db.transaction(async (tx) => {
    await tx.insert(memoryCommits).values({ id: crypto.randomUUID(), version });
    await tx.insert(evidenceAdmissions).values({
      revisionId: stage.id,
      uploadId: stage.uploadId,
      commitVersion: version,
      sourceTime: null,
    });
    for (const [i, n] of nodes.entries()) {
      if (!project || i > 0)
        await tx.insert(memoryNodes).values({ ...n, createdVersion: version });
      const children =
        i === 0
          ? [{ nodeId: topic, versionId: ids[1] }]
          : i === 1 || i === 2
            ? [{ nodeId: segment, versionId: ids[3] }]
            : [];
      await tx.insert(memoryNodeVersions).values({
        id: ids[i],
        nodeId: n.id,
        commitVersion: version,
        payload: {
          id: ids[i],
          nodeId: n.id,
          title:
            i === 0
              ? 'Calibration project'
              : i === 3
                ? 'Calibration evidence'
                : 'Research notes',
          summary: 'Calibration discussion. Details are in original evidence.',
          keywords: ['calibration'],
          warnings: [],
          model: 'regression',
          promptVersion: 'regression',
          children,
          segment:
            i === 3
              ? {
                  revisionId: stage.id,
                  firstUnit: 0,
                  lastUnit: 0,
                  unitSchemaVersion: 1,
                  contextOnly: false,
                }
              : null,
        },
      });
    }
  });
  return { version, projectId: root, segmentId: segment };
}
function provider(
  options: {
    afterRead?: () => Promise<void>;
    invalid?: boolean;
    fail?: boolean;
    delay?: number;
  } = {},
) {
  let calls = 0,
    done = false,
    readId = '';
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      calls++;
      if (options.fail)
        return Response.json(
          { error: { message: 'offline' } },
          { status: 503 },
        );
      const body = await req.json();
      if (options.delay) await Bun.sleep(options.delay);
      const tool = body.messages.filter((m: any) => m.role === 'tool').at(-1);
      let message: any;
      if (!tool)
        message = {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'read-source',
              type: 'function',
              function: {
                name: 'openSegment',
                arguments: JSON.stringify({ nodeId: segmentId }),
              },
            },
          ],
        };
      else {
        const result = JSON.parse(tool.content);
        readId = result.texts?.[0]?.citationId ?? readId;
        if (!done) {
          done = true;
          await options.afterRead?.();
        }
        const repaired = body.messages.some(
          (m: any) =>
            m.role === 'user' &&
            typeof m.content === 'string' &&
            m.content.startsWith('Your answer was rejected'),
        );
        message = {
          role: 'assistant',
          content: JSON.stringify({
            status: 'answered',
            claims: [
              {
                text: 'The source reports calibration error of 0.2 mm.',
                basis: 'source',
                citations: [
                  options.invalid && !repaired ? crypto.randomUUID() : readId,
                ],
              },
            ],
            limitations: [],
          }),
        };
      }
      return Response.json({
        id: 'regression',
        object: 'chat.completion',
        created: 1,
        model: 'test',
        choices: [{ index: 0, finish_reason: 'stop', message }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      });
    },
  });
  return {
    llm: {
      client: new OpenAI({
        apiKey: 'test',
        baseURL: `http://localhost:${server.port}/v1`,
        maxRetries: 0,
      }),
      model: 'test',
    },
    get calls() {
      return calls;
    },
    stop() {
      server.stop(true);
    },
  };
}
check(
  'research creation pins an admitted snapshot and idempotency is scoped to the original question',
  async () => {
    stage = await source('Calibration error is 0.2 mm. RareDetailZX91.');
    const seeded = await admit(stage);
    projectId = seeded.projectId;
    segmentId = seeded.segmentId;
    firstVersion = seeded.version;
    const key = crypto.randomUUID(),
      input = {
        question: 'What is the calibration error?',
        idempotencyKey: key,
        projectId,
      };
    const run = await createResearch(input);
    expect(run.scope.version).toBe(firstVersion);
    expect((await createResearch(input)).id).toBe(run.id);
    await expect(
      createResearch({ ...input, question: 'different' }),
    ).rejects.toThrow('different');
    await expect(
      createResearch({
        ...input,
        idempotencyKey: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
      }),
    ).rejects.toThrow('unavailable');
    const [outbox] = await db
      .select()
      .from(researchOutbox)
      .where(eq(researchOutbox.id, run.id));
    expect(outbox.dispatchedAt).toBeNull();
    await cancelResearch(run.id);
  },
);
check(
  'SDK citation repair, concurrent push, staging corrections and decoys preserve the query snapshot',
  async () => {
    const control = await source('Unpushed secret decoy.');
    const corrected = await correctStage(stage.uploadId, {
      baseRevisionId: stage.id,
      label: stage.metadata.label,
      sourceTime: null,
      edits: [
        {
          primitiveId: stage.primitives[0].id,
          text: 'NEW UNPUSHED calibration error 9 mm.',
          speaker: null,
        },
      ],
    });
    const run = await createResearch({
      question: 'What is the error?',
      projectId,
      idempotencyKey: crypto.randomUUID(),
    });
    const fake = provider({
      invalid: true,
      afterRead: async () => {
        await admit(
          await source('FutureProjectProgress unseen by the running question.'),
        );
      },
    });
    try {
      await research(run.id, { llm: fake.llm });
      const result = await getResearch(run.id);
      expect(result.state).toBe('completed');
      expect(result.scope.version).toBe(firstVersion);
      expect(fake.calls).toBe(3);
      expect(result.answer!.citations[0].revisionId).toBe(stage.id);
      expect(result.answer!.citations[0].quote).toContain('0.2 mm');
      const corpus = await loadResearchCorpus(result.scope);
      expect(
        corpus.search('UNPUSHED secret FutureProjectProgress').hits,
      ).toHaveLength(0);
      expect(corpus.data.stages.has(control.id)).toBe(false);
      expect(corpus.data.stages.has(corrected.id)).toBe(false);
      const count = (await memorySnapshot()).version;
      await research(run.id, { llm: fake.llm });
      expect(fake.calls).toBe(3);
      expect((await memorySnapshot()).version).toBe(count);
    } finally {
      fake.stop();
    }
  },
);
check(
  'provider failure and retry preserve scope and completed answers never mutate memory',
  async () => {
    const run = await createResearch({
        question: 'What is the error?',
        projectId,
        idempotencyKey: crypto.randomUUID(),
      }),
      offline = provider({ fail: true });
    try {
      await expect(research(run.id, { llm: offline.llm })).rejects.toThrow();
    } finally {
      offline.stop();
    }
    expect((await getResearch(run.id)).state).toBe('failed');
    await retryResearch(run.id);
    expect((await getResearch(run.id)).scope).toEqual(run.scope);
    const before = await memorySnapshot(),
      fake = provider();
    try {
      await research(run.id, { llm: fake.llm });
      expect((await getResearch(run.id)).state).toBe('completed');
      expect(await memorySnapshot()).toEqual(before);
    } finally {
      fake.stop();
    }
  },
);
check(
  'cancellation prevents publication and duplicate concurrent deliveries have one answer effect',
  async () => {
    const run = await createResearch({
        question: 'What is the error?',
        projectId,
        idempotencyKey: crypto.randomUUID(),
      }),
      fake = provider({ delay: 300 });
    try {
      const promise = research(run.id, {
        llm: fake.llm,
        progress: async () => {
          await cancelResearch(run.id);
        },
      });
      await expect(promise).rejects.toThrow();
      expect((await getResearch(run.id)).state).toBe('canceled');
      expect((await getResearch(run.id)).answer).toBeNull();
      await retryResearch(run.id);
      const outcomes = await Promise.allSettled([
        research(run.id, { llm: fake.llm }),
        research(run.id, { llm: fake.llm }),
      ]);
      expect(outcomes.some((r) => r.status === 'fulfilled')).toBe(true);
      expect((await getResearch(run.id)).state).toBe('completed');
      expect((await getResearch(run.id)).attempts).toBe(2);
    } finally {
      fake.stop();
    }
  },
);
check(
  'reserved research queue answers while an ingestion lane is blocked, and durable dispatch survives restart',
  async () => {
    const run = await createResearch({
        question: 'What is the error?',
        projectId,
        idempotencyKey: crypto.randomUUID(),
      }),
      fake = provider(),
      boss = await startQueue();
    let release!: () => void, ingestionStarted!: () => void;
    const blocked = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (ingestionStarted = r));
    try {
      await boss.work(queueName, { batchSize: 1 }, async () => {
        ingestionStarted();
        await blocked;
      });
      await boss.work<{ runId: string }>(
        researchQueue,
        { batchSize: 1 },
        async (jobs) => {
          for (const job of jobs)
            await research(job.data.runId, { llm: fake.llm });
        },
      );
      await boss.send(queueName, { runId: crypto.randomUUID() });
      await started;
      await dispatchResearch(boss);
      await dispatchResearch(boss);
      for (let i = 0; i < 50; i++) {
        if ((await getResearch(run.id)).state === 'completed') break;
        await Bun.sleep(200);
      }
      expect((await getResearch(run.id)).state).toBe('completed');
      const [outbox] = await db
        .select()
        .from(researchOutbox)
        .where(eq(researchOutbox.id, run.id));
      expect(outbox.dispatchedAt).not.toBeNull();
    } finally {
      release();
      await boss.stop({ graceful: true, timeout: 5000 });
      fake.stop();
    }
  },
  20000,
);
check(
  'worker redelivery recovers processing state and historical answers survive a pushed correction',
  async () => {
    const run = await createResearch({
      question: 'What was the calibration error?',
      projectId,
      idempotencyKey: crypto.randomUUID(),
    });
    await db
      .update(researchRuns)
      .set({ state: 'processing', attempts: 1 })
      .where(eq(researchRuns.id, run.id));
    const fake = provider();
    try {
      await research(run.id, { llm: fake.llm });
      const answered = await getResearch(run.id);
      expect(answered.state).toBe('completed');
      expect(answered.attempts).toBe(2);
      const corrected = await correctStage(stage.uploadId, {
        baseRevisionId: (await getUpload(stage.uploadId)).revisions[0].id,
        label: stage.metadata.label,
        sourceTime: null,
        edits: [
          {
            primitiveId: stage.primitives[0].id,
            text: 'Calibration error corrected to 0.15 mm.',
            speaker: null,
          },
        ],
      });
      const next = await admit(corrected, projectId);
      const historical = await loadResearchCorpus(answered.scope);
      expect(historical.openSegment(segmentId).texts[0].text).toContain(
        '0.2 mm',
      );
      const latest = await loadResearchCorpus({
        version: next.version,
        projectId,
      });
      expect(() => latest.openSegment(segmentId)).toThrow();
      const oldVersion = historical.openSegment(segmentId).versionId;
      const reopened = latest.openSegment(segmentId, 0, oldVersion);
      expect(reopened.historical).toBe(true);
      expect(reopened.texts[0].text).toContain('0.2 mm');
      expect((await getResearch(run.id)).answer).toEqual(answered.answer);
    } finally {
      fake.stop();
    }
  },
);
check(
  'retry after a queued cancellation gets a fresh delivery even if the original job already completed',
  async () => {
    const run = await createResearch({
        question: 'What is the current calibration error?',
        idempotencyKey: crypto.randomUUID(),
      }),
      fake = provider(),
      boss = await startQueue();
    let deliveries = 0;
    try {
      await dispatchResearch(boss);
      await cancelResearch(run.id);
      await boss.work<{ runId: string }>(
        researchQueue,
        { batchSize: 1 },
        async (jobs) => {
          for (const job of jobs) {
            await research(job.data.runId, { llm: fake.llm });
            if (job.data.runId === run.id) deliveries++;
          }
        },
      );
      for (let i = 0; i < 40 && !deliveries; i++) await Bun.sleep(200);
      expect(deliveries).toBe(1);
      expect((await getResearch(run.id)).attempts).toBe(0);
      // This query targets the current corrected segment after the prior history test.
      const latest = await loadResearchCorpus(run.scope);
      segmentId = latest.view.segments.find(
        (n) => latest.active.has(n.id) && n.revisionId !== stage.id,
      )!.id;
      await retryResearch(run.id);
      await dispatchResearch(boss);
      for (let i = 0; i < 50; i++) {
        if ((await getResearch(run.id)).state === 'completed') break;
        await Bun.sleep(200);
      }
      expect((await getResearch(run.id)).state).toBe('completed');
      expect(deliveries).toBe(2);
      const [row] = await db
        .select()
        .from(researchOutbox)
        .where(eq(researchOutbox.id, run.id));
      expect(row.generation).toBe(1);
    } finally {
      await boss.stop({ graceful: true, timeout: 5000 });
      fake.stop();
    }
  },
  25000,
);
