import { test, expect } from 'bun:test';
import type { Stage } from '../src/lib/server/contracts';
import type {
  OrganizationSnapshot,
  NodeVersion,
} from '../src/lib/server/contracts/organization';
import {
  ResearchCorpus,
  queryTerms,
} from '../src/lib/server/agents/researcher/retrieval';
import {
  researchInput,
  answerProposal,
} from '../src/lib/server/contracts/research';
const ids = Array.from(
  { length: 15 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
const [
  project,
  topic,
  source,
  segment,
  revision,
  primitive,
  upload,
  image,
  asset,
  other,
  otherSegment,
  otherRevision,
] = ids;
function fixture(effectiveAt?: string) {
  const stage = {
    id: revision,
    metadata: { sourceTime: null, sourceTimeOrigin: 'unknown' },
    primitives: [
      {
        id: primitive,
        kind: 'text',
        role: 'native',
        text: 'Calibration error is 0.2 mm. RareDetailZX91. 中文測試。',
        speaker: null,
        locator: { kind: 'text', start: 0, end: 49 },
      },
      {
        id: image,
        kind: 'image',
        assetId: asset,
        role: 'frame',
        locator: {
          kind: 'media',
          timeline: 'container',
          startMs: 10,
          endMs: 10,
        },
      },
    ],
    annotations: [{ transcriptIds: [primitive], frameIds: [image] }],
    coverage: { complete: true },
  } as unknown as Stage;
  const node = (
    id: string,
    kind: 'project' | 'topic' | 'source' | 'segment',
    revisionId: string | null = null,
    scopeId: string | null = null,
  ) => ({ id, kind, revisionId, scopeId, createdVersion: 1 });
  const version = (
    nodeId: string,
    children: string[] = [],
    leaf = false,
  ): NodeVersion => ({
    id: crypto.randomUUID(),
    nodeId,
    commitVersion: 1,
    title: nodeId === segment ? 'Calibration' : 'Research',
    summary: 'A summary that omits the rare detail.',
    keywords: ['calibration'],
    warnings: [],
    children: [],
    segment: leaf
      ? {
          revisionId: revision,
          firstUnit: 0,
          lastUnit: 0,
          unitSchemaVersion: 1,
          contextOnly: false,
        }
      : null,
    model: 'test',
    promptVersion: 'test',
  });
  const versions = [
    version(project),
    version(topic),
    version(source),
    version(segment, [], true),
    version(other),
    version(otherSegment, [], true),
  ];
  for (const [index, children] of [
    [0, [topic]],
    [1, [segment]],
    [2, [segment]],
    [4, [otherSegment]],
  ] as [number, string[]][])
    versions[index].children = children.map((id) => ({
      nodeId: id,
      versionId: versions.find((v) => v.nodeId === id)!.id,
    }));
  versions[5].segment!.revisionId = otherRevision;
  const snapshot: OrganizationSnapshot = {
    version: 1,
    nodes: [
      node(project, 'project'),
      node(topic, 'topic', null, project),
      node(source, 'source', revision),
      node(segment, 'segment', revision, source),
      node(other, 'project'),
      node(otherSegment, 'segment', otherRevision),
    ],
    versions,
    admissions: [
      {
        revisionId: revision,
        uploadId: upload,
        commitVersion: 1,
        sourceTime: null,
      },
      {
        revisionId: otherRevision,
        uploadId: asset,
        commitVersion: 1,
        sourceTime: null,
      },
    ],
    commits: [
      { version: 1, createdAt: new Date().toISOString(), pushId: null },
    ],
  };
  const corpus = new ResearchCorpus(
    {
      snapshot,
      stages: new Map([
        [revision, { stage, filename: 'notes.txt' }],
        [
          otherRevision,
          { stage: { ...stage, id: otherRevision }, filename: 'other.txt' },
        ],
      ]),
    },
    { version: 1, projectId: project, ...(effectiveAt ? { effectiveAt } : {}) },
  );
  return { corpus, stage, snapshot };
}
test('query schema rejects scope injection and invalid dates', () => {
  expect(() =>
    researchInput.parse({
      question: 'q',
      idempotencyKey: 'x',
      rawPath: '/data',
    }),
  ).toThrow();
  expect(() =>
    researchInput.parse({
      question: 'q',
      idempotencyKey: 'x',
      effectiveAt: '2026-02-30',
    }),
  ).toThrow();
});
test('multilingual terms normalize Chinese without requiring whitespace', () => {
  expect(queryTerms('什么是简体中文')).toContain('簡體');
  expect(queryTerms('What is calibration?')).toEqual(['calibration']);
});
test('rank fusion searches original details omitted from summaries', () => {
  const { corpus } = fixture();
  const result = corpus.search('RareDetailZX91');
  expect(result.hits.map((h) => h.nodeId)).toEqual([segment]);
  expect(result.hits[0].sourceMatched).toBe(true);
});
test('project scope rejects other projects, their segments, invented IDs and versions', () => {
  const { corpus } = fixture();
  expect(() => corpus.openSegment(otherSegment)).toThrow();
  expect(() => corpus.openNode(other)).toThrow();
  expect(() => corpus.openNode(segment, 0, crypto.randomUUID())).toThrow();
  expect(corpus.catalog().nodes.map((n) => n.nodeId)).toEqual([
    project,
    source,
  ]);
});
test('original text citations preserve exact ranges and pinned URLs', () => {
  const { corpus, stage } = fixture();
  const opened = corpus.openSegment(segment);
  const id = opened.texts[0].citationId;
  const answer = corpus.validate({
    status: 'answered',
    claims: [{ text: 'Error is 0.2 mm.', basis: 'source', citations: [id] }],
    limitations: [],
  });
  expect(answer.citations[0].quote).toBe(
    stage.primitives[0].kind === 'text' ? stage.primitives[0].text : '',
  );
  expect(answer.citations[0].url).toContain('knownVersion=1&first=0&last=');
});
test('listing an image is insufficient to cite it; actual inspection is required', () => {
  const { corpus } = fixture();
  const id = corpus.openSegment(segment).images[0].citationId;
  const candidate = {
    status: 'answered',
    claims: [{ text: 'Visual detail.', basis: 'source', citations: [id] }],
    limitations: [],
  } as const;
  expect(() => corpus.validate(answerProposal.parse(candidate))).toThrow(
    'not inspected',
  );
  expect(corpus.image(id).assetId).toBe(asset);
  corpus.inspected.add(id);
  expect(
    corpus.validate(answerProposal.parse(candidate)).citations[0].kind,
  ).toBe('image');
});
test('unknown dates are excluded from event-cutoff queries with an explicit warning', () => {
  const { corpus } = fixture('2026-09-30');
  expect(() => corpus.openSegment(segment)).toThrow();
  expect(
    corpus.search('calibration').hits.every((n) => n.kind !== 'segment'),
  ).toBe(true);
  expect([...corpus.warnings].join(' ')).toContain('excludes unknown dates');
});
test('recorded history tools cannot widen the snapshot', () => {
  const { corpus } = fixture();
  expect(() => corpus.changes(0, 2)).toThrow();
  expect(() => corpus.history(other)).toThrow();
  expect(corpus.history(project).versions).toHaveLength(1);
});
test('fabricated citations and summary-only claims cannot publish an answer', () => {
  const { corpus } = fixture();
  expect(() =>
    corpus.validate({
      status: 'answered',
      claims: [
        { text: 'Claim', basis: 'source', citations: [crypto.randomUUID()] },
      ],
      limitations: [],
    }),
  ).toThrow();
  expect(() =>
    corpus.validate({ status: 'answered', claims: [], limitations: [] }),
  ).toThrow();
  expect(() =>
    corpus.validate({
      status: 'insufficient_evidence',
      claims: [],
      limitations: [],
    }),
  ).toThrow();
});
test('long original text paginates without silent loss and enforces evidence budget', () => {
  const { corpus, stage } = fixture();
  if (stage.primitives[0].kind === 'text')
    stage.primitives[0].text = 'x'.repeat(80000);
  corpus.data.snapshot.versions.find(
    (v) => v.nodeId === segment,
  )!.segment!.lastUnit = 9;
  let offset = 0,
    total = 0;
  for (let i = 0; i < 10; i++) {
    const r = corpus.openSegment(segment, offset);
    total += r.texts.reduce((n, t) => n + t.text.length, 0);
    if (r.nextOffset === null || r.nextOffset === offset) break;
    offset = r.nextOffset;
  }
  expect(total).toBeLessThanOrEqual(42000);
  expect(total).toBeGreaterThan(30000);
  expect([...corpus.warnings].join(' ')).toContain('budget exhausted');
});
