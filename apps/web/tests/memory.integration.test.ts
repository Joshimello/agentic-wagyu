import { test, expect, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, sqlClient } from '../src/lib/server/db/client';
import {
  acceptUpload,
  getUpload,
  memoryCount,
} from '../src/lib/server/services/uploads';
import { correctStage } from '../src/lib/server/services/staging';
import {
  createPush,
  retryPush,
  getPush,
} from '../src/lib/server/services/pushes';
import {
  memorySnapshot,
  memoryView,
  evidenceView,
} from '../src/lib/server/services/memory';
import { interpret } from '../src/lib/server/agents/interpreter';
import { chronicle } from '../src/lib/server/agents/chronicler';
import {
  publishMemory,
  StaleMemory,
} from '../src/lib/server/agents/chronicler/publication';
import { buildMemoryPlan } from '../src/lib/server/agents/chronicler/model';
import {
  stableId,
  type Plan,
  type Snapshot,
  type StatementVersion,
} from '../src/lib/server/contracts/memory';
import type { Stage } from '../src/lib/server/contracts';
import { pushBatches, knowledgeEvents } from '../src/lib/server/db/schema';
const enabled = process.env.MEMORY_TEST === 'true',
  check = test.skipIf(!enabled);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});
async function source(text: string, time = '2026-09-08T00:00:00Z') {
  const accepted = await acceptUpload(
    new File([text], 'meeting-notes.txt', { type: 'text/plain' }),
    { sourceTime: time },
  );
  await interpret(accepted.runId);
  return (await getUpload(accepted.uploadId)).revisions[0].manifest;
}
const input = (stage: Stage) => ({
  idempotencyKey: crypto.randomUUID(),
  items: [
    { uploadId: stage.uploadId, revisionId: stage.id, acceptPartial: false },
  ],
});
function plan(
  pushId: string,
  stage: Stage,
  snapshot: Snapshot,
  options: {
    projectId?: string;
    statementId?: string;
    status?: 'planned' | 'done';
    target?: StatementVersion;
    operation?: 'supersede' | 'support' | 'conflict';
    reverse?: boolean;
    noAssertions?: boolean;
  } = {},
): Plan {
  const projectId = options.projectId ?? stableId(pushId, 'project'),
    statementId = options.statementId ?? stableId(pushId, 'statement'),
    versionId = stableId(pushId, 'version');
  const evidence = [
    { revisionId: stage.id, primitiveId: stage.primitives[0].id, quote: null },
  ];
  const status = options.status ?? 'planned';
  const result: Plan = {
    baseVersion: snapshot.version,
    model: 'regression',
    promptVersion: 'regression',
    projects: options.projectId
      ? []
      : [
          {
            id: projectId,
            name: 'Sensor calibration',
            description: 'Depth sensor calibration study',
            aliases: [],
            evidence,
            origin: 'model',
          },
        ],
    entities: [],
    statements: options.statementId
      ? []
      : [
          {
            id: statementId,
            projectId,
            type: 'Commitment',
            stateKey: 'sensor.calibration',
          },
        ],
    versions: [
      {
        id: versionId,
        statementId,
        text: `Calibrate sensor: ${status}.`,
        arguments: {
          task: 'Calibrate sensor',
          owner: 'Alice',
          status,
          dueDate: null,
        },
        effectiveDate: stage.metadata.sourceTime?.slice(0, 10) ?? null,
        evidence,
        entityIds: [],
        updateBasisQuote:
          status === 'done'
            ? stage.primitives[0].kind === 'text'
              ? stage.primitives[0].text
              : null
            : null,
        model: 'regression',
        promptVersion: 'regression',
      },
    ],
    relations: [],
    outcomes: [
      {
        uploadId: stage.uploadId,
        revisionId: stage.id,
        disposition: 'incorporated',
        assertions: 1,
        warnings: [],
      },
    ],
  };
  if (options.target)
    result.relations.push({
      id: stableId(pushId, 'relation'),
      fromVersionId: options.reverse ? options.target.id : versionId,
      toVersionId: options.reverse ? versionId : options.target.id,
      kind: options.operation ?? 'supersede',
      reason: 'Explicit source-reported update to calibration',
    });
  if (options.noAssertions) {
    result.projects = [];
    result.statements = [];
    result.versions = [];
    result.outcomes[0] = {
      ...result.outcomes[0],
      disposition: 'no_assertions',
      assertions: 0,
    };
  }
  return result;
}
check(
  'a mixed push publishes both source scopes atomically and rejects an invalid second source',
  async () => {
    const camera = await source('Alice plans to calibrate the camera.'),
      thermal = await source('Alice plans to calibrate the thermal sensor.');
    const batch = await createPush({
      ...input(camera),
      items: [...input(camera).items, ...input(thermal).items],
    });
    const snapshot = await memorySnapshot();
    const a = plan(batch.id, camera, snapshot),
      b = plan(stableId(batch.id, 'thermal'), thermal, snapshot);
    a.projects[0].name = 'Camera calibration';
    b.projects[0].name = 'Thermal sensor calibration';
    const prepared: Plan = {
      ...a,
      projects: [...a.projects, ...b.projects],
      statements: [...a.statements, ...b.statements],
      versions: [...a.versions, ...b.versions],
      outcomes: [...a.outcomes, ...b.outcomes],
    };
    const invalid = structuredClone(prepared);
    invalid.versions[1].evidence[0].quote = 'Invented thermal evidence';
    await expect(publishMemory(batch.id, invalid)).rejects.toThrow(
      'quotation differs',
    );
    expect(await memoryCount()).toBe(snapshot.version);
    expect(
      (await memorySnapshot()).admissions.some((r) =>
        [camera.id, thermal.id].includes(r.revisionId),
      ),
    ).toBe(false);
    const committed = await publishMemory(batch.id, prepared);
    expect(committed.commitVersion).toBe(snapshot.version + 1);
    expect(committed.outcomes).toHaveLength(2);
    const after = await memorySnapshot();
    expect(
      after.admissions.filter((r) =>
        [camera.id, thermal.id].includes(r.revisionId),
      ),
    ).toHaveLength(2);
    expect(
      after.statements
        .filter((s) => prepared.statements.some((p) => p.id === s.id))
        .map((s) => s.projectId)
        .sort(),
    ).toEqual(prepared.projects.map((p) => p.id).sort());
  },
);
check(
  'push pins a reviewed revision, double-clicks converge, edits and unpushed controls cannot alter memory',
  async () => {
    const stage = await source('Alice plans to calibrate the sensor.');
    const control = await source('Unpushed control must never appear.');
    const request = input(stage),
      batch = await createPush(request);
    expect(
      (await createPush({ ...request, idempotencyKey: crypto.randomUUID() }))
        .id,
    ).toBe(batch.id);
    expect((await createPush(request)).id).toBe(batch.id);
    await expect(
      createPush({
        ...request,
        items: [
          {
            uploadId: control.uploadId,
            revisionId: control.id,
            acceptPartial: false,
          },
        ],
      }),
    ).rejects.toThrow('Idempotency key');
    await correctStage(stage.uploadId, {
      baseRevisionId: stage.id,
      label: stage.metadata.label,
      sourceTime: stage.metadata.sourceTime,
      edits: [
        {
          primitiveId: stage.primitives[0].id,
          text: 'Bob plans a different task.',
          speaker: null,
        },
      ],
    });
    const prepared = plan(batch.id, stage, await memorySnapshot());
    const before = await memoryCount();
    await Promise.all([
      publishMemory(batch.id, prepared),
      publishMemory(batch.id, prepared),
    ]);
    expect(await memoryCount()).toBe(before + 1);
    expect((await getUpload(stage.uploadId)).memory.state).toBe(
      'changes_not_pushed',
    );
    expect(
      (await evidenceView(stage.id, stage.primitives[0].id)).primitive,
    ).toEqual(stage.primitives[0]);
    await expect(
      evidenceView(control.id, control.primitives[0].id),
    ).rejects.toThrow('not been admitted');
    const now = await memorySnapshot();
    expect(now.admissions.some((a) => a.revisionId === control.id)).toBe(false);
    await chronicle(batch.id);
    expect(await memoryCount()).toBe(before + 1);
    const { POST: repeat } = await import('../src/routes/api/pushes/+server');
    const repeated = await repeat({
      request: new Request('http://localhost/api/pushes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }),
    });
    const publicBatch = await repeated.json();
    expect(publicBatch.id).toBe(batch.id);
    expect(publicBatch).not.toHaveProperty('checkpoints');
    expect(publicBatch).not.toHaveProperty('plan');
    const { POST: retry } = await import(
      '../src/routes/api/pushes/[id]/retry/+server'
    );
    const replayed = await (await retry({ params: { id: batch.id } })).json();
    expect(replayed).not.toHaveProperty('checkpoints');
    expect(replayed).not.toHaveProperty('plan');
    expect(await memoryCount()).toBe(before + 1);
  },
);
check(
  'model/infrastructure failure publishes nothing and retry preserves the exact input',
  async () => {
    const stage = await source(
      'Alice plans calibration for another instrument.',
    );
    const batch = await createPush(input(stage)),
      before = await memoryCount();
    await expect(
      chronicle(batch.id, {
        buildPlan: async () => {
          throw new Error('Serving failure');
        },
      }),
    ).rejects.toThrow('Serving failure');
    expect(await memoryCount()).toBe(before);
    expect((await getPush(batch.id)).state).toBe('failed');
    await retryPush(batch.id);
    const done = await chronicle(batch.id, {
      buildPlan: async (id, _, stages, snapshot) =>
        plan(id, stages[0], snapshot),
    });
    expect(done!.state).toBe('committed');
    expect(done!.input.items[0].revisionId).toBe(stage.id);
    expect(await memoryCount()).toBe(before + 1);
  },
);
check(
  'a transaction interrupted during assertion insertion rolls back admission, identities and commit',
  async () => {
    const stage = await source(
      'This source will test transactional publication.',
    );
    const batch = await createPush(input(stage)),
      prepared = plan(batch.id, stage, await memorySnapshot()),
      before = await memoryCount();
    await sqlClient.unsafe(
      "CREATE FUNCTION fail_memory_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'publication interruption'; END $$",
    );
    await sqlClient.unsafe(
      'CREATE TRIGGER fail_memory_insert BEFORE INSERT ON statement_versions FOR EACH ROW EXECUTE FUNCTION fail_memory_test()',
    );
    try {
      await expect(publishMemory(batch.id, prepared)).rejects.toThrow(
        'statement_versions',
      );
      expect(await memoryCount()).toBe(before);
      expect(
        (await memorySnapshot()).projects.some(
          (p) => p.id === prepared.projects[0].id,
        ),
      ).toBe(false);
      expect(
        (await memorySnapshot()).admissions.some(
          (a) => a.revisionId === stage.id,
        ),
      ).toBe(false);
    } finally {
      await sqlClient.unsafe(
        'DROP TRIGGER fail_memory_insert ON statement_versions',
      );
      await sqlClient.unsafe('DROP FUNCTION fail_memory_test()');
    }
    await publishMemory(batch.id, prepared);
    expect(await memoryCount()).toBe(before + 1);
  },
);
check(
  'no-assertion sources have disclosed outcomes and unchanged repush cannot duplicate memory',
  async () => {
    const stage = await source('Thanks, see you next week.');
    const batch = await createPush(input(stage)),
      before = await memoryCount();
    const prepared = plan(batch.id, stage, await memorySnapshot(), {
      noAssertions: true,
    });
    await publishMemory(batch.id, prepared);
    expect((await getPush(batch.id)).outcomes[0].disposition).toBe(
      'no_assertions',
    );
    expect(await memoryCount()).toBe(before + 1);
    const repeated = await createPush({
      ...input(stage),
      projectScope: { mode: 'new', name: 'Separate project' },
    });
    const noOp = await publishMemory(repeated.id, prepared);
    expect(noOp.outcomes[0].disposition).toBe('duplicate');
    expect(await memoryCount()).toBe(before + 1);
  },
);
check(
  'stale concurrent work refreshes reconciliation before publication',
  async () => {
    const a = await source('First concurrent calibration.'),
      b = await source('Second concurrent calibration.');
    const first = await createPush(input(a)),
      second = await createPush(input(b));
    let calls = 0;
    await chronicle(second.id, {
      buildPlan: async (id, _, stages, snapshot) => {
        calls++;
        if (calls === 1)
          await publishMemory(first.id, plan(first.id, a, snapshot));
        return plan(id, stages[0], snapshot);
      },
    });
    expect(calls).toBe(2);
    expect((await getPush(second.id)).state).toBe('committed');
  },
);
for (const reverse of [false, true])
  check(
    `weekly task progress rebuilds correctly with ${reverse ? 'newer-first' : 'older-first'} arrival`,
    async () => {
      const a = await source(
          'Alice plans to calibrate the sensor.',
          '2026-09-08T00:00:00Z',
        ),
        b = await source('Calibration is complete.', '2026-09-15T00:00:00Z');
      const firstStage = reverse ? b : a,
        secondStage = reverse ? a : b;
      const first = await createPush(input(firstStage));
      const firstPlan = plan(first.id, firstStage, await memorySnapshot(), {
        status: reverse ? 'done' : 'planned',
      });
      await publishMemory(first.id, firstPlan);
      const cutoff = (await memorySnapshot()).version;
      const second = await createPush(input(secondStage));
      const prepared = plan(second.id, secondStage, await memorySnapshot(), {
        projectId: firstPlan.projects[0].id,
        statementId: firstPlan.statements[0].id,
        status: reverse ? 'planned' : 'done',
        target: { ...firstPlan.versions[0], commitVersion: cutoff },
        reverse,
      });
      await publishMemory(second.id, prepared);
      const projectId = firstPlan.projects[0].id;
      expect(
        (await memoryView({ projectId })).statements[0].current.arguments,
      ).toMatchObject({ status: 'done' });
      expect(
        (await memoryView({ projectId, effectiveDate: '2026-09-10' }))
          .statements[0].current.arguments,
      ).toMatchObject({ status: 'planned' });
      expect(
        (await memoryView({ projectId, knownVersion: cutoff })).statements[0]
          .current.arguments,
      ).toMatchObject({ status: reverse ? 'done' : 'planned' });
      expect(
        (await memoryView({ projectId })).statements[0].history,
      ).toHaveLength(2);
      expect(await memoryView({ projectId })).toEqual(
        await memoryView({ projectId }),
      );
    },
  );
check(
  'conflicts remain visible, project scopes never cross, and corrected support has recorded history',
  async () => {
    const a = await source('Alice plans to calibrate the sensor.'),
      b = await source('Calibration is complete.');
    const first = await createPush(input(a)),
      pa = plan(first.id, a, await memorySnapshot());
    await publishMemory(first.id, pa);
    const recorded = await memorySnapshot();
    const second = await createPush(input(b));
    const pb = plan(second.id, b, recorded, {
      projectId: pa.projects[0].id,
      status: 'done',
      target: { ...pa.versions[0], commitVersion: recorded.version },
      operation: 'conflict',
    });
    await publishMemory(second.id, pb);
    expect(
      (await memoryView({ projectId: pa.projects[0].id })).statements.map(
        (s) => s.status,
      ),
    ).toEqual(['conflicted', 'conflicted']);
    const other = await source(
      'A different calibration study uses the same task name.',
    );
    const third = await createPush(input(other)),
      pc = plan(third.id, other, await memorySnapshot());
    pc.relations.push({
      id: crypto.randomUUID(),
      fromVersionId: pc.versions[0].id,
      toVersionId: pa.versions[0].id,
      kind: 'conflict',
      reason: 'Invalid cross-project relation',
    });
    await expect(publishMemory(third.id, pc)).rejects.toThrow('cross-scope');
    pc.relations = [];
    await publishMemory(third.id, pc);
    const cutoff = (await memorySnapshot()).version;
    await correctStage(a.uploadId, {
      baseRevisionId: a.id,
      label: a.metadata.label,
      sourceTime: a.metadata.sourceTime,
      edits: [
        {
          primitiveId: a.primitives[0].id,
          text: 'Alice withdrew that calibration plan.',
          speaker: null,
        },
      ],
    });
    const corrected = (await getUpload(a.uploadId)).revisions[0].manifest;
    const correction = await createPush(input(corrected));
    await publishMemory(
      correction.id,
      plan(correction.id, corrected, await memorySnapshot(), {
        noAssertions: true,
      }),
    );
    expect(
      (await memoryView({ projectId: pa.projects[0].id })).statements.find(
        (s) => s.id === pa.statements[0].id,
      )!.status,
    ).toBe('withdrawn');
    expect(
      (
        await memoryView({ projectId: pa.projects[0].id, knownVersion: cutoff })
      ).statements.find((s) => s.id === pa.statements[0].id)!.status,
    ).toBe('conflicted');
    expect((await evidenceView(a.id, a.primitives[0].id)).primitive).toEqual(
      a.primitives[0],
    );
  },
);
check(
  'invalid evidence is withheld by the actual SDK extraction pipeline and cache replay makes no model calls',
  async () => {
    const stage = await source('Alice plans sensor calibration.');
    const batch = await createPush(input(stage));
    let calls = 0;
    let repairIssues: { path: string; code: string }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        calls++;
        const body = (await request.json()) as any;
        const payload = JSON.parse(body.messages[1].content[0].text);
        if (payload.validationIssues) repairIssues = payload.validationIssues;
        const content =
          payload.task === 'extract'
            ? {
                projects: [
                  {
                    ref: 'P1',
                    name: 'Sensor study',
                    description: 'Calibrating a depth sensor',
                    aliases: [],
                    matchId: null,
                    matchConfidence: 0,
                    matchReason: 'New scoped study',
                    evidenceRefs: ['E1'],
                  },
                ],
                entities: [],
                assertions: [
                  {
                    ref: 'C1',
                    projectRef: 'P1',
                    entityRefs: [],
                    type: 'Commitment',
                    text: 'Calibrate a depth sensor.',
                    stateKey: 'sensor.calibration',
                    evidenceRefs: ['INVENTED'],
                    effectiveDate: null,
                    updateBasisQuote: null,
                    arguments: {
                      task: 'Calibrate sensor',
                      owner: 'Alice',
                      status: calls === 1 ? 'unsupported-status' : 'planned',
                      dueDate: null,
                    },
                  },
                ],
                warnings: [],
              }
            : { decisions: [] };
        return Response.json({
          id: 'local-memory',
          object: 'chat.completion',
          model: 'local-memory',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(content) },
            },
          ],
        });
      },
    });
    const { default: OpenAI } = await import('openai');
    const llm = {
      model: 'local-memory',
      client: new OpenAI({
        apiKey: 'local-regression',
        baseURL: `http://localhost:${server.port}`,
        maxRetries: 0,
      }),
    };
    try {
      const snapshot = await memorySnapshot();
      const first = await buildMemoryPlan(
        batch.id,
        batch.input,
        [stage],
        snapshot,
        { llm },
      );
      expect(first.versions).toHaveLength(0);
      expect(repairIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'assertions.0.arguments.status',
            code: 'invalid_value',
          }),
        ]),
      );
      expect(first.outcomes[0].warnings.join(' ')).toContain('withheld');
      const before = calls;
      await buildMemoryPlan(batch.id, batch.input, [stage], snapshot, { llm });
      expect(calls).toBe(before);
      await publishMemory(batch.id, first);
      expect((await getPush(batch.id)).outcomes[0].disposition).toBe(
        'no_assertions',
      );
    } finally {
      server.stop(true);
    }
  },
);

check(
  'actual SDK proposals initialize a project, record a weekly update, and attach equivalent support',
  async () => {
    const a = await source(
        'Alice plans to calibrate the sensor.',
        '2026-09-08T00:00:00Z',
      ),
      b = await source('Calibration is complete.', '2026-09-15T00:00:00Z'),
      c = await source('Calibration remains complete.', '2026-09-22T00:00:00Z');
    let projectId: string | null = null,
      targetId: string | null = null,
      status: 'planned' | 'done' = 'planned';
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as any,
          payload = JSON.parse(body.messages[1].content[0].text);
        const content =
          payload.task === 'extract'
            ? {
                projects: [
                  {
                    ref: 'P1',
                    name: 'Sensor completion study',
                    description:
                      'Calibrating the depth sensor for the indoor reconstruction study',
                    aliases: [],
                    matchId: projectId,
                    matchConfidence: projectId ? 0.99 : 0,
                    matchReason:
                      'The same sensor calibration task and research purpose continue across the weekly progress report.',
                    evidenceRefs: ['E1'],
                  },
                ],
                entities: [],
                assertions: [
                  {
                    ref: 'C1',
                    projectRef: 'P1',
                    entityRefs: [],
                    type: 'Commitment',
                    text: `Calibrate the depth sensor: ${status}.`,
                    stateKey: 'sensor.calibration',
                    evidenceRefs: ['E1'],
                    effectiveDate: null,
                    updateBasisQuote:
                      status === 'done'
                        ? payload.input.primitives[0].text
                        : null,
                    arguments: {
                      task: 'Calibrate sensor',
                      owner: 'Alice',
                      status,
                      dueDate: null,
                    },
                  },
                ],
                warnings: [],
              }
            : {
                decisions: [
                  {
                    ref: 'C1',
                    operation:
                      payload.input.proposals[0].arguments.status ===
                      payload.input.candidates.find(
                        (v: any) => v.id === targetId,
                      ).arguments.status
                        ? 'support'
                        : 'supersede',
                    targetVersionId: targetId,
                    reason:
                      'Same project and task; status follows explicit source report.',
                  },
                ],
              };
        return Response.json({
          id: 'sdk-memory',
          object: 'chat.completion',
          model: 'sdk-memory',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(content) },
            },
          ],
        });
      },
    });
    const { default: OpenAI } = await import('openai');
    const llm = {
      model: 'sdk-memory',
      client: new OpenAI({
        apiKey: 'local-regression',
        baseURL: `http://localhost:${server.port}`,
        maxRetries: 0,
      }),
    };
    try {
      for (const stage of [a, b, c]) {
        const batch = await createPush(input(stage));
        const prepared = await buildMemoryPlan(
          batch.id,
          batch.input,
          [stage],
          await memorySnapshot(),
          { llm },
        );
        await publishMemory(batch.id, prepared);
        projectId = (await memorySnapshot()).statements.find(
          (s) => s.id === prepared.versions[0].statementId,
        )!.projectId;
        targetId = prepared.versions[0].id;
        status = 'done';
      }
      const view = await memoryView({ projectId: projectId! });
      expect(view.statements).toHaveLength(1);
      expect(view.statements[0].history).toHaveLength(3);
      expect(view.statements[0].current.arguments).toMatchObject({
        status: 'done',
      });
      expect(view.relations.map((r) => r.kind).sort()).toEqual(
        (['supersede', 'support'] as ('supersede' | 'support')[]).sort(),
      );
    } finally {
      server.stop(true);
    }
  },
);

check(
  'durable push dispatch can be replayed without losing jobs or duplicating accepted memory',
  async () => {
    const { startQueue, dispatchPushes } = await import(
      '../src/lib/server/jobs/queue'
    );
    const { chroniclerOutbox } = await import('../src/lib/server/db/schema');
    const stage = await source('Dispatch calibration plan.');
    const batch = await createPush(input(stage));
    const boss = await startQueue();
    try {
      await dispatchPushes(boss);
      await db
        .update(chroniclerOutbox)
        .set({ dispatchedAt: null })
        .where(eq(chroniclerOutbox.id, batch.id));
      await dispatchPushes(boss);
      const [row] =
        await sqlClient`select count(*)::int as count from pgboss.job where name='chronicle' and data->>'pushId'=${batch.id}`;
      expect(row.count).toBe(1);
      const before = await memoryCount();
      await chronicle(batch.id, {
        buildPlan: async (id, _, stages, snapshot) =>
          plan(id, stages[0], snapshot),
      });
      await chronicle(batch.id);
      expect(await memoryCount()).toBe(before + 1);
    } finally {
      await boss.stop({ graceful: true, timeout: 5000 });
    }
  },
);
