import {
  spanText,
  spanPartsFromRange,
} from '../src/lib/server/services/evidence-spans';
import { test, expect } from 'bun:test';
import OpenAI from 'openai';
import { answerQuestion } from '../src/lib/server/agents/researcher/model';
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
test('project-scoped source overviews hide summaries containing other-project segments', () => {
  const { corpus, snapshot } = fixture();
  const sourceVersion = snapshot.versions.find((v) => v.nodeId === source)!;
  sourceVersion.summary = 'Other project confidential detail.';
  sourceVersion.children.push({
    nodeId: otherSegment,
    versionId: snapshot.versions.find((v) => v.nodeId === otherSegment)!.id,
  });
  const scoped = new ResearchCorpus(corpus.data, corpus.scope);
  expect(scoped.openNode(source).summary).not.toContain('confidential');
  expect(scoped.openNode(source).children.map((c) => c.nodeId)).toEqual([
    segment,
  ]);
  expect(JSON.stringify(scoped.catalog())).not.toContain('confidential');
  expect(scoped.search('confidential').hits).toHaveLength(0);
});
test('event cutoff hides future text and future aggregate prose but retains eligible dates', () => {
  const { corpus, stage } = fixture();
  stage.metadata.sourceTime = '2026-09-22T00:00:00.000Z';
  stage.metadata.sourceTimeOrigin = 'file';
  const early = new ResearchCorpus(corpus.data, {
    ...corpus.scope,
    effectiveAt: '2026-09-15',
  });
  expect(() => early.openSegment(segment)).toThrow();
  expect(early.openNode(project).summary).toContain('filtered');
  const included = new ResearchCorpus(corpus.data, {
    ...corpus.scope,
    effectiveAt: '2026-09-30',
  });
  expect(included.openSegment(segment).texts.length).toBeGreaterThan(0);
  expect(included.openSegment(segment).dateOrigin).toBe('file');
});

test('context budget produces an explicit limited answer without more retrieval calls', async () => {
  const { corpus } = fixture();
  corpus.catalog = () => ({
    snapshot: corpus.scope,
    total: 0,
    offset: 0,
    truncated: false,
    nodes: [],
    warnings: ['x'.repeat(110000)],
  });
  let toolsEnabled = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = await request.json();
      toolsEnabled = !!body.tools;
      return Response.json({
        id: 'budget',
        object: 'chat.completion',
        created: 1,
        model: 'test',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                status: 'partial',
                claims: [],
                limitations: [
                  'The context budget was reached before evidence could be inspected.',
                ],
              }),
            },
          },
        ],
      });
    },
  });
  try {
    const result = await answerQuestion('What is known?', corpus, {
      llm: {
        client: new OpenAI({
          apiKey: 'test',
          baseURL: `http://localhost:${server.port}/v1`,
          maxRetries: 0,
        }),
        model: 'test',
      },
    });
    expect(toolsEnabled).toBe(false);
    expect(result.answer.status).toBe('partial');
    expect(result.answer.warnings.join(' ')).toContain('budget reached');
    expect(result.usage.calls).toBe(1);
  } finally {
    server.stop(true);
  }
});

test('contiguous speech turns become complete cited spans with exact source pointers and speaker context', () => {
  const { corpus, stage, snapshot } = fixture();
  stage.primitives = Array.from({ length: 12 }, (_, i) => ({
    id: crypto.randomUUID(),
    kind: 'text',
    role: 'asr',
    text: `Turn ${i} gives calibration context.`,
    speaker: i % 2 ? 'S02' : 'S01',
    locator: {
      kind: 'media',
      timeline: 'container',
      startMs: i * 1000,
      endMs: i * 1000 + 900,
    },
  }));
  stage.annotations = [];
  snapshot.versions.find((v) => v.nodeId === segment)!.segment!.lastUnit = 11;
  const read = corpus.openSegment(segment);
  expect(read.texts).toHaveLength(1);
  expect(read.nextOffset).toBeNull();
  expect(read.texts[0].text).toContain('Turn 11');
  expect(read.texts[0].text).toContain('S02');
  const c = corpus.evidence.get(read.texts[0].citationId)!;
  expect(c.parts).toHaveLength(12);
  for (const part of c.parts!) {
    const p = stage.primitives.find((p) => p.id === part.primitiveId)!;
    expect(
      p.kind === 'text' &&
        read.texts[0].text.includes(p.text.slice(part.first, part.last)),
    ).toBe(true);
  }
  const reconstructed = spanPartsFromRange(
    stage,
    c.primitiveId,
    c.parts!.at(-1)!.primitiveId,
    c.first!,
    c.last!,
  );
  expect(reconstructed).toEqual(c.parts!);
  expect(spanText(stage, reconstructed)).toBe(c.quote!);
  expect(c.locator).toEqual({
    kind: 'media',
    timeline: 'container',
    startMs: 0,
    endMs: 11900,
  });
  expect(c.url).toContain('&through=');
  expect(() =>
    spanPartsFromRange(stage, c.primitiveId, crypto.randomUUID(), 0, 1),
  ).toThrow();
  expect(() =>
    spanPartsFromRange(
      stage,
      c.primitiveId,
      c.parts!.at(-1)!.primitiveId,
      0,
      100000,
    ),
  ).toThrow();
});
