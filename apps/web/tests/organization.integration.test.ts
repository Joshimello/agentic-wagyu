import { chronicle } from '../src/lib/server/agents/chronicler';
import { test, expect, afterAll } from 'bun:test';
import OpenAI from 'openai';
import { eq, sql } from 'drizzle-orm';
import { db, sqlClient } from '../src/lib/server/db/client';
import {
  pushBatches,
  memoryCommits,
  memoryNodes,
  memoryProjects,
} from '../src/lib/server/db/schema';
import { acceptUpload, getUpload } from '../src/lib/server/services/uploads';
import { interpret } from '../src/lib/server/agents/interpreter';
import {
  createPush,
  retryPush,
  getPush,
} from '../src/lib/server/services/pushes';
import { memorySnapshot } from '../src/lib/server/services/memory';
import {
  organizationView,
  openMemoryNode,
  searchOrganization,
} from '../src/lib/server/services/organization';
import { correctStage } from '../src/lib/server/services/staging';
import { buildOrganizationPlan } from '../src/lib/server/agents/chronicler/organization/model';
import {
  publishMemory,
  StaleMemory,
} from '../src/lib/server/agents/chronicler/publication';
import type { Stage } from '../src/lib/server/contracts';
const enabled = process.env.ORGANIZATION_TEST === 'true',
  check = test.skipIf(!enabled);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});
async function source(text: string) {
  const accepted = await acceptUpload(
    new File([text], 'research-notes.txt', { type: 'text/plain' }),
    {},
  );
  await interpret(accepted.runId);
  return (await getUpload(accepted.uploadId)).revisions[0].manifest;
}

check(
  'summary pushes accept organized project scopes while assertions require legacy project identities',
  async () => {
    const stage = await source('Research scope selection regression.');
    const version = (await memorySnapshot()).version + 1;
    await db.insert(memoryCommits).values({ id: crypto.randomUUID(), version });
    const organizedId = crypto.randomUUID(),
      topicId = crypto.randomUUID(),
      legacyId = crypto.randomUUID();
    await db.insert(memoryNodes).values([
      { id: organizedId, kind: 'project', createdVersion: version },
      {
        id: topicId,
        kind: 'topic',
        scopeId: organizedId,
        createdVersion: version,
      },
    ]);
    await db
      .insert(memoryProjects)
      .values({
        id: legacyId,
        name: 'Sensor calibration scope regression',
        description: 'Legacy sensor project',
        aliases: [],
        evidence: [],
        origin: 'user',
        createdVersion: version,
      });
    const request = (
      workflow: 'summary' | 'assertions',
      projectId: string,
    ) => ({
      ...input(stage),
      workflow,
      projectScope: { mode: 'existing', projectId },
    });
    expect(
      (await createPush(request('summary', organizedId))).input.projectScope,
    ).toEqual({ mode: 'existing', projectId: organizedId });
    await expect(
      createPush(request('assertions', organizedId)),
    ).rejects.toThrow('Selected project does not exist');
    await expect(createPush(request('summary', topicId))).rejects.toThrow(
      'Selected project does not exist',
    );
    await expect(
      createPush(request('summary', crypto.randomUUID())),
    ).rejects.toThrow('Selected project does not exist');
    expect((await createPush(request('summary', legacyId))).state).toBe(
      'queued',
    );
    expect((await createPush(request('assertions', legacyId))).state).toBe(
      'queued',
    );
  },
);
const input = (stage: Stage) => ({
  idempotencyKey: crypto.randomUUID(),
  items: [
    { uploadId: stage.uploadId, revisionId: stage.id, acceptPartial: false },
  ],
});
function model(
  options: { unassigned?: boolean; matchConfidence?: number } = {},
) {
  let calls = 0,
    rejected = false;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      calls++;
      const body = await req.json(),
        payload = JSON.parse(body.messages[1].content[0].text);
      let output: any;
      if (payload.task === 'segment-source') {
        const project = payload.input.catalog.find(
            (n: any) => n.kind === 'project',
          ),
          topic = payload.input.catalog.find((n: any) => n.kind === 'topic');
        output = {
          segments: [
            {
              firstUnit: payload.input.firstUnit,
              lastUnit: payload.input.lastUnit,
              title: 'Depth sensor calibration',
              summary:
                'The calibration discussion covers measured accuracy and remaining uncertainty.',
              keywords: ['calibration'],
              contextOnly: false,
              project: {
                name: 'Depth sensing',
                description: 'Ongoing depth sensor research',
                matchId: project?.id ?? null,
                confidence: options.matchConfidence ?? 1,
                reason:
                  'The same sensor calibration research purpose continues.',
              },
              topic: {
                name: 'Calibration',
                description: 'Calibration accuracy over repeated measurements',
                matchId: topic?.id ?? null,
                confidence: options.matchConfidence ?? 1,
                reason: 'The same calibration discussion continues.',
              },
              continuesPrevious: false,
            },
          ],
          warnings: [],
        };
        if (options.unassigned) {
          output.segments[0].project = null;
          output.segments[0].topic = null;
          output.warnings = [
            'Project attribution unresolved in this first pass.',
          ];
        }
        if (!rejected) {
          rejected = true;
          output.segments[0].firstUnit++;
        }
      } else if (payload.task === 'scope-unassigned') {
        const project = payload.input.catalog.find(
            (n: any) => n.kind === 'project',
          ),
          topic = payload.input.catalog.find(
            (n: any) => n.kind === 'topic' && n.projectId === project?.id,
          );
        output = {
          assignments: [
            {
              segmentId: payload.input.segments[0].segmentId,
              project: {
                name: 'Depth sensing',
                description: 'Ongoing depth sensor research',
                matchId: project?.id ?? null,
                confidence: options.matchConfidence ?? 1,
                reason:
                  'The calibration discussion shares the same research objective.',
              },
              topic: {
                name: 'Calibration',
                description: 'Calibration accuracy',
                matchId: topic?.id ?? null,
                confidence: options.matchConfidence ?? 1,
                reason: 'The same calibration purpose continues.',
              },
            },
          ],
          warnings: [],
        };
      } else
        output = {
          summary:
            'The research focuses on depth calibration and discusses progress alongside unresolved measurement uncertainty.',
          keywords: ['depth', 'calibration'],
          warnings: [],
        };
      return Response.json({
        id: 'test',
        object: 'chat.completion',
        created: 1,
        model: 'qwen-regression',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(output) },
          },
        ],
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
      model: 'qwen-regression',
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
  'SDK repairs missing coverage, retries cached work, publishes atomically and keeps exact text searchable',
  async () => {
    const stage = await source(
      'Calibration error measured 0.2 mm. RareDetailZX91 remains a pending concern.',
    );
    const control = await source(
      'UnpushedControl must never appear in memory.',
    );
    const batch = await createPush(input(stage)),
      base = await memorySnapshot(),
      fake = model();
    try {
      const plan = await buildOrganizationPlan(
        batch.id,
        batch.input,
        [stage],
        base,
        { llm: fake.llm },
      );
      expect(fake.calls).toBeGreaterThan(4);
      const count = fake.calls;
      const replay = await buildOrganizationPlan(
        batch.id,
        batch.input,
        [stage],
        base,
        { llm: fake.llm },
      );
      expect(fake.calls).toBe(count);
      expect(replay).toEqual(plan);
      const broken = structuredClone(plan);
      broken.organization!.versions.find((v) => v.segment)!.segment!.lastUnit =
        99;
      await expect(publishMemory(batch.id, broken)).rejects.toThrow();
      expect((await memorySnapshot()).version).toBe(base.version);
      await publishMemory(batch.id, plan);
      const view = await organizationView();
      expect(view.sources).toHaveLength(1);
      expect(view.projects).toHaveLength(1);
      expect(view.segments).toHaveLength(1);
      const leaf = await openMemoryNode(view.segments[0].id);
      expect(leaf.parents.map((p) => p.kind).sort()).toEqual([
        'source',
        'topic',
      ]);
      expect(leaf.source!.content!.texts[0].text).toContain('RareDetailZX91');
      const search = await searchOrganization('RareDetailZX91');
      expect(search.hits).toHaveLength(1);
      expect(search.hits[0].sourceMatched).toBe(true);
      expect((await searchOrganization('UnpushedControl')).total).toBe(0);
      expect(
        (await memorySnapshot()).admissions.some(
          (a) => a.revisionId === control.id,
        ),
      ).toBe(false);
      const duplicate = await createPush(input(stage));
      expect(duplicate.id).toBe(batch.id);
      expect(
        (await organizationView({ knownVersion: base.version })).nodes,
      ).toHaveLength(0);
    } finally {
      fake.stop();
    }
  },
);
check(
  'weekly sources share project/topic identities; corrections replace current leaves without changing historical children',
  async () => {
    const firstView = await organizationView(),
      project = firstView.projects[0],
      oldTopic = firstView.topics[0],
      oldLeaf = firstView.segments[0];
    const next = await source(
      'Calibration measurement improved to 0.1 mm, with noise unresolved. SupersededDetailYK7.',
    );
    const batch = await createPush(input(next)),
      base = await memorySnapshot(),
      fake = model();
    try {
      const plan = await buildOrganizationPlan(
        batch.id,
        batch.input,
        [next],
        base,
        { llm: fake.llm },
      );
      await publishMemory(batch.id, plan);
      let view = await organizationView();
      expect(view.projects).toHaveLength(1);
      expect(view.projects[0].id).toBe(project.id);
      expect(view.topics[0].children).toHaveLength(2);
      const historical = await openMemoryNode(oldTopic.id, {
        versionId: oldTopic.current.id,
      });
      expect(historical.children.map((c) => c.id)).toEqual([oldLeaf.id]);
      const corrected = await correctStage(next.uploadId, {
        baseRevisionId: next.id,
        label: next.metadata.label,
        sourceTime: null,
        edits: [
          {
            primitiveId: next.primitives[0].id,
            text: 'Calibration result corrected to 0.15 mm. CorrectedDetailXR2.',
            speaker: null,
          },
        ],
      });
      expect((await searchOrganization('CorrectedDetailXR2')).total).toBe(0);
      const pushed = await createPush(input(corrected)),
        snapshot = await memorySnapshot();
      const correctionPlan = await buildOrganizationPlan(
        pushed.id,
        pushed.input,
        [corrected],
        snapshot,
        { llm: fake.llm },
      );
      await publishMemory(pushed.id, correctionPlan);
      view = await organizationView();
      expect(view.sources).toHaveLength(2);
      expect(view.topics[0].children).toHaveLength(2);
      expect(view.segments.some((s) => s.revisionId === next.id)).toBe(false);
      expect((await searchOrganization('CorrectedDetailXR2')).total).toBe(1);
      expect((await searchOrganization('SupersededDetailYK7')).total).toBe(0);
      expect(
        (
          await organizationView({ knownVersion: snapshot.version })
        ).segments.some((s) => s.revisionId === next.id),
      ).toBe(true);
    } finally {
      fake.stop();
    }
  },
);
check(
  'concurrent summary publication refuses stale plans and failed pushes keep their selection',
  async () => {
    const a = await source('Additional calibration discussion.'),
      b = await source('Another calibration discussion.');
    const pa = await createPush(input(a)),
      pb = await createPush(input(b)),
      base = await memorySnapshot(),
      fake = model();
    try {
      const planA = await buildOrganizationPlan(pa.id, pa.input, [a], base, {
          llm: fake.llm,
        }),
        planB = await buildOrganizationPlan(pb.id, pb.input, [b], base, {
          llm: fake.llm,
        });
      await publishMemory(pa.id, planA);
      await expect(publishMemory(pb.id, planB)).rejects.toBeInstanceOf(
        StaleMemory,
      );
      await db
        .update(pushBatches)
        .set({ state: 'failed' })
        .where(eq(pushBatches.id, pb.id));
      await retryPush(pb.id);
      expect((await getPush(pb.id)).input.items[0].revisionId).toBe(b.id);
      const refreshed = await buildOrganizationPlan(
        pb.id,
        pb.input,
        [b],
        await memorySnapshot(),
        { llm: fake.llm },
      );
      await publishMemory(pb.id, refreshed);
      expect(
        (await organizationView()).sources.some((s) => s.revisionId === b.id),
      ).toBe(true);
    } finally {
      fake.stop();
    }
  },
);

check(
  'interruption during summary insertion rolls back nodes, admissions and commit together',
  async () => {
    const stage = await source('Calibration evidence for atomic rollback.');
    const batch = await createPush(input(stage)),
      base = await memorySnapshot(),
      fake = model();
    try {
      const plan = await buildOrganizationPlan(
        batch.id,
        batch.input,
        [stage],
        base,
        { llm: fake.llm },
      );
      await db.execute(
        sql`create function reject_summary_insert() returns trigger language plpgsql as $$ begin raise exception 'simulated write interruption'; end $$`,
      );
      await db.execute(
        sql`create trigger reject_summary_insert before insert on memory_node_versions for each row execute function reject_summary_insert()`,
      );
      try {
        await expect(publishMemory(batch.id, plan)).rejects.toThrow(
          'insert into "memory_node_versions"',
        );
      } finally {
        await db.execute(
          sql`drop trigger reject_summary_insert on memory_node_versions`,
        );
        await db.execute(sql`drop function reject_summary_insert()`);
      }
      expect((await memorySnapshot()).version).toBe(base.version);
      expect(
        (await organizationView()).sources.some(
          (s) => s.revisionId === stage.id,
        ),
      ).toBe(false);
      expect(
        (await memorySnapshot()).admissions.some(
          (a) => a.revisionId === stage.id,
        ),
      ).toBe(false);
      await publishMemory(batch.id, plan);
      expect(
        (await organizationView()).sources.some(
          (s) => s.revisionId === stage.id,
        ),
      ).toBe(true);
    } finally {
      fake.stop();
    }
  },
);

check(
  'an explicit scope pass organizes unassigned leaves without rewriting source summaries or evidence',
  async () => {
    const stage = await source(
      'Depth calibration details requiring later project organization.',
    );
    await expect(
      createPush({ ...input(stage), organizationMode: 'scope' }),
    ).rejects.toThrow('Organize the source');
    const batch = await createPush(input(stage)),
      base = await memorySnapshot(),
      fake = model({ unassigned: true });
    try {
      const plan = await buildOrganizationPlan(
        batch.id,
        batch.input,
        [stage],
        base,
        { llm: fake.llm },
      );
      await publishMemory(batch.id, plan);
      const before = await organizationView(),
        leaf = before.segments.find((s) => s.revisionId === stage.id)!;
      expect(
        (await openMemoryNode(leaf.id)).parents.map((p) => p.kind),
      ).toEqual(['source']);
      const admissionCount = (await memorySnapshot()).admissions.length;
      const scoped = await createPush({
        ...input(stage),
        organizationMode: 'scope',
      });
      const scopePlan = await buildOrganizationPlan(
        scoped.id,
        scoped.input,
        [stage],
        await memorySnapshot(),
        { llm: fake.llm },
      );
      expect(
        scopePlan.organization!.nodes.every(
          (n) => n.kind === 'project' || n.kind === 'topic',
        ),
      ).toBe(true);
      expect(
        scopePlan.organization!.versions.every((v) => v.segment === null),
      ).toBe(true);
      await publishMemory(scoped.id, scopePlan);
      const opened = await openMemoryNode(leaf.id);
      expect(opened.parents.map((p) => p.kind).sort()).toEqual([
        'source',
        'topic',
      ]);
      expect(opened.node.history).toHaveLength(1);
      expect(opened.node.current.id).toBe(leaf.current.id);
      expect((await memorySnapshot()).admissions.length).toBe(admissionCount);
      expect(
        (
          await openMemoryNode(leaf.id, { knownVersion: before.version })
        ).parents.map((p) => p.kind),
      ).toEqual(['source']);
      expect(
        (await createPush({ ...input(stage), organizationMode: 'scope' })).id,
      ).toBe(scoped.id);
    } finally {
      fake.stop();
    }
  },
);

check(
  'cancellation between source blocks stops model calls and preserves memory and canceled outcome',
  async () => {
    const stage = await source(
      'Calibration discussion canceled before its first model request.',
    );
    const batch = await createPush(input(stage)),
      base = await memorySnapshot(),
      fake = model();
    try {
      await chronicle(batch.id, {
        buildPlan: async (id, input, stages, snapshot) =>
          buildOrganizationPlan(id, input, stages, snapshot, {
            llm: fake.llm,
            progress: async () => {
              await db
                .update(pushBatches)
                .set({ state: 'canceled', progress: 'Canceled by operator' })
                .where(eq(pushBatches.id, id));
            },
          }),
      });
      const outcome = await getPush(batch.id);
      expect(outcome.state).toBe('canceled');
      expect(outcome.progress).toBe('Canceled by operator');
      expect(fake.calls).toBe(0);
      expect((await memorySnapshot()).version).toBe(base.version);
    } finally {
      fake.stop();
    }
  },
);

check(
  'a low-confidence catalog match cannot merge same-name projects across sources',
  async () => {
    const stage = await source(
      'Potentially unrelated calibration effort with uncertain project attribution.',
    );
    const batch = await createPush(input(stage)),
      base = await memorySnapshot(),
      before = await organizationView(),
      fake = model({ matchConfidence: 0.8 });
    try {
      const plan = await buildOrganizationPlan(
        batch.id,
        batch.input,
        [stage],
        base,
        { llm: fake.llm },
      );
      expect(plan.projects).toHaveLength(1);
      expect(before.projects.some((p) => p.id === plan.projects[0].id)).toBe(
        false,
      );
      expect(
        plan.outcomes[0].warnings.some((w) =>
          w.includes('Uncertain project match'),
        ),
      ).toBe(true);
      await publishMemory(batch.id, plan);
      expect((await organizationView()).projects).toHaveLength(
        before.projects.length + 1,
      );
    } finally {
      fake.stop();
    }
  },
);
