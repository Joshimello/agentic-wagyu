import { test, expect } from 'bun:test';
import { reduceMemory } from '../src/lib/server/services/memory';
import {
  assertionSchema,
  date,
  pushInput,
  validateEvidence,
  stableId,
  type Snapshot,
  type StatementVersion,
} from '../src/lib/server/contracts/memory';
import type { Stage } from '../src/lib/server/contracts';
const id = (key: string) => stableId('memory regression', key);
function history(): Snapshot {
  const project = id('project'),
    statement = id('task'),
    revision = id('weekA'),
    revisionB = id('weekB');
  const version = (
    key: string,
    commitVersion: number,
    status: 'planned' | 'done',
    effectiveDate: string,
    source: string,
  ): StatementVersion => ({
    id: id(key),
    statementId: statement,
    commitVersion,
    text: `Alice's calibration task is ${status}.`,
    arguments: {
      task: 'Calibrate sensor',
      owner: 'Alice',
      status,
      dueDate: null,
    },
    effectiveDate,
    evidence: [
      { revisionId: source, primitiveId: id('evidence' + key), quote: null },
    ],
    entityIds: [],
    updateBasisQuote: status === 'done' ? 'Calibration is complete.' : null,
    model: 'regression',
    promptVersion: 'regression',
  });
  return {
    version: 2,
    projects: [
      {
        id: project,
        name: 'Sensor research',
        description: 'Calibrating depth sensors',
        aliases: [],
        createdVersion: 1,
        evidence: [],
        origin: 'model',
      },
    ],
    entities: [],
    statements: [
      {
        id: statement,
        projectId: project,
        type: 'Commitment',
        stateKey: 'sensor.calibration',
        createdVersion: 1,
      },
    ],
    versions: [
      version('planned', 1, 'planned', '2026-09-08', revision),
      version('done', 2, 'done', '2026-09-15', revisionB),
    ],
    relations: [
      {
        id: id('replacement'),
        fromVersionId: id('done'),
        toVersionId: id('planned'),
        kind: 'supersede',
        commitVersion: 2,
        reason: 'Explicit completion',
      },
    ],
    admissions: [
      {
        uploadId: id('uploadA'),
        revisionId: revision,
        commitVersion: 1,
        sourceTime: null,
      },
      {
        uploadId: id('uploadB'),
        revisionId: revisionB,
        commitVersion: 2,
        sourceTime: null,
      },
    ],
    events: [],
    commits: [
      { version: 1, createdAt: '2026-09-09T00:00:00Z', pushId: id('pushA') },
      { version: 2, createdAt: '2026-09-16T00:00:00Z', pushId: id('pushB') },
    ],
  };
}
test('typed assertion registry validates status, experimental conditions, calendar dates and strict fields', () => {
  expect(date.safeParse('2026-02-30').success).toBe(false);
  expect(date.safeParse('not a date').success).toBe(false);
  expect(
    pushInput.parse({
      idempotencyKey: 'click',
      items: [{ uploadId: id('u'), revisionId: id('r'), acceptPartial: false }],
    }).projectScope.mode,
  ).toBe('auto');
  const proposal = {
    ref: 'C1',
    projectRef: 'P1',
    entityRefs: [],
    type: 'Finding',
    text: 'Reported measurement',
    stateKey: 'depth.rmse',
    evidenceRefs: ['E1'],
    effectiveDate: null,
    updateBasisQuote: null,
    arguments: {
      finding: 'RMSE measurement',
      conditions: 'Under indoor fluorescent light',
      metric: 'RMSE',
      value: '2',
      units: 'cm',
    },
  };
  expect(assertionSchema.safeParse(proposal).success).toBe(true);
  expect(
    assertionSchema.safeParse({
      ...proposal,
      arguments: { ...proposal.arguments, conditions: '' },
    }).success,
  ).toBe(false);
});
test('current state and effective history preserve previous versions', () => {
  const snapshot = history(),
    before = structuredClone(snapshot);
  expect(reduceMemory(snapshot).statements[0].current.id).toBe(id('done'));
  expect(
    reduceMemory(snapshot, { effectiveDate: '2026-09-10' }).statements[0]
      .current.id,
  ).toBe(id('planned'));
  expect(
    reduceMemory({ ...snapshot, version: 1 }).statements[0].current.id,
  ).toBe(id('planned'));
  expect(reduceMemory(snapshot).statements[0].history).toHaveLength(2);
  expect(snapshot).toEqual(before);
});
test('older evidence pushed later reconstructs effective history independently from commit order', () => {
  const snapshot = history();
  snapshot.versions[0].commitVersion = 2;
  snapshot.versions[1].commitVersion = 1;
  snapshot.admissions[0].commitVersion = 2;
  snapshot.admissions[1].commitVersion = 1;
  expect(reduceMemory(snapshot).statements[0].current.id).toBe(id('done'));
  expect(
    reduceMemory(snapshot, { effectiveDate: '2026-09-10' }).statements[0]
      .current.id,
  ).toBe(id('planned'));
  expect(
    reduceMemory({ ...snapshot, version: 1 }, { effectiveDate: '2026-09-10' })
      .statements[0].status,
  ).toBe('future');
});
test('conflicts keep both claims instead of selecting by arrival order', () => {
  const snapshot = history();
  snapshot.statements.push({
    ...snapshot.statements[0],
    id: id('disputed'),
    createdVersion: 2,
  });
  snapshot.versions[1].statementId = id('disputed');
  snapshot.relations[0].kind = 'conflict';
  expect(reduceMemory(snapshot).statements.map((s) => s.status)).toEqual([
    'conflicted',
    'conflicted',
  ]);
  expect(reduceMemory({ ...snapshot, version: 1 }).statements).toHaveLength(1);
});
test('corrected sources invalidate old support only after admission; historical citations remain', () => {
  const snapshot = history();
  snapshot.version = 3;
  snapshot.admissions.push({
    uploadId: id('uploadA'),
    revisionId: id('correctedA'),
    commitVersion: 3,
    sourceTime: null,
  });
  const now = reduceMemory(snapshot);
  expect(now.statements[0].history[0].evidence[0].revisionId).toBe(id('weekA'));
  expect(
    now.statements[0].evidence.some((e) => e.revisionId === id('weekA')),
  ).toBe(false);
  expect(
    reduceMemory({ ...snapshot, version: 1 }).statements[0].evidence[0]
      .revisionId,
  ).toBe(id('weekA'));
  snapshot.admissions.push({
    uploadId: id('uploadB'),
    revisionId: id('correctedB'),
    commitVersion: 3,
    sourceTime: null,
  });
  expect(reduceMemory(snapshot).statements[0].status).toBe('withdrawn');
});
test('same names and state keys remain scoped to separate projects', () => {
  const snapshot = history(),
    second = id('unrelatedProject');
  snapshot.projects.push({
    ...snapshot.projects[0],
    id: second,
    name: 'Sensor research',
    description: 'A different research project',
  });
  snapshot.statements.push({
    ...snapshot.statements[0],
    id: id('otherTask'),
    projectId: second,
  });
  snapshot.versions.push({
    ...snapshot.versions[0],
    id: id('otherVersion'),
    statementId: id('otherTask'),
  });
  expect(
    reduceMemory(snapshot, { projectId: second }).statements.map((s) => s.id),
  ).toEqual([id('otherTask')]);
  expect(reduceMemory(snapshot).projects).toHaveLength(2);
});
test('unknown event dates remain explicit and rebuilding the graph is deterministic', () => {
  const snapshot = history();
  snapshot.versions[1].effectiveDate = null;
  expect(reduceMemory(snapshot).statements[0].dateUncertain).toBe(true);
  expect(reduceMemory(snapshot)).toEqual(
    reduceMemory(structuredClone(snapshot)),
  );
});
test('evidence validation rejects unpushed sources, invented quotations and boilerplate', () => {
  const stage = {
    id: id('stage'),
    primitives: [
      { id: id('text'), kind: 'text', text: 'Calibration is complete.' },
      { id: id('logo'), kind: 'image' },
    ],
    document: { review: { skippedMedia: [{ evidenceIds: [id('logo')] }] } },
  } as unknown as Stage;
  const evidence = [
    { revisionId: stage.id, primitiveId: id('text'), quote: 'complete' },
  ];
  expect(() =>
    validateEvidence(evidence, [stage], new Set([stage.id])),
  ).not.toThrow();
  expect(() => validateEvidence(evidence, [stage], new Set())).toThrow(
    'outside pinned',
  );
  expect(() =>
    validateEvidence(
      [{ ...evidence[0], quote: 'failed' }],
      [stage],
      new Set([stage.id]),
    ),
  ).toThrow('quotation differs');
  expect(() =>
    validateEvidence(
      [{ ...evidence[0], primitiveId: id('logo'), quote: null }],
      [stage],
      new Set([stage.id]),
    ),
  ).toThrow('Boilerplate');
});

test('Chronicler source blocks read every text character and page with bounded image/context inputs', async () => {
  const { sourceBlocks } =
    await import('../src/lib/server/agents/chronicler/source');
  const primitive = {
    id: id('long'),
    kind: 'text' as const,
    role: 'native' as const,
    text: 'A'.repeat(20000),
    speaker: null,
    locator: { kind: 'text' as const, start: 0, end: 20000 },
  };
  const stage = {
    id: id('long-stage'),
    primitives: [primitive],
    annotations: [],
  } as unknown as Stage;
  const blocks = sourceBlocks(stage);
  expect(blocks).toHaveLength(3);
  expect(
    blocks
      .flatMap((b) => b.primitives)
      .filter((p) => p.kind === 'text')
      .map((p) => (p.kind === 'text' ? p.text : ''))
      .join(''),
  ).toBe(primitive.text);
  expect(
    blocks.every(
      (b) =>
        b.primitives
          .filter((p) => p.kind === 'text')
          .reduce((n, p) => n + (p.kind === 'text' ? p.text.length : 0), 0) <=
        8000,
    ),
  ).toBe(true);
  const document = {
    ...stage,
    primitives: Array.from({ length: 9 }, (_, index) => ({
      id: id('page' + index),
      kind: 'image',
      role: 'page',
      assetId: id('asset' + index),
      locator: { kind: 'page', page: index + 1 },
      actualMs: null,
      requestedMs: null,
    })),
    document: {
      units: Array.from({ length: 9 }, (_, index) => ({
        number: index + 1,
        renderId: id('page' + index),
        textIds: [],
      })),
    },
  } as unknown as Stage;
  expect(
    sourceBlocks(document)
      .flatMap((b) => b.primitives)
      .map((p) => p.id),
  ).toEqual(document.primitives.map((p) => p.id));
  expect(
    sourceBlocks(document).every(
      (b) => b.primitives.filter((p) => p.kind === 'image').length <= 4,
    ),
  ).toBe(true);
});
