import { test, expect } from 'bun:test';
import type { Stage } from '../src/lib/server/contracts';
import { stableId } from '../src/lib/server/contracts/memory';
import {
  validatePartition,
  type OrganizationSnapshot,
} from '../src/lib/server/contracts/organization';
import {
  sourceUnits,
  unitBlocks,
  segmentContent,
} from '../src/lib/server/agents/chronicler/organization/source';
import { reduceOrganization } from '../src/lib/server/services/organization';
import { validateOrganization } from '../src/lib/server/agents/chronicler/organization/validation';
const id = (s: string) => stableId('organization-regression', s);
const stage = {
  id: id('revision'),
  uploadId: id('upload'),
  primitives: [
    {
      id: id('text'),
      kind: 'text',
      role: 'native',
      text: 'A'.repeat(20001),
      speaker: null,
      locator: { kind: 'text', start: 0, end: 20001 },
    },
  ],
  annotations: [],
} as unknown as Stage;
const node = (
  name: string,
  kind: 'project' | 'topic' | 'source' | 'segment',
  scope: string | null = null,
  revision: string | null = null,
) => ({
  id: id(name),
  kind,
  scopeId: scope ? id(scope) : null,
  revisionId: revision ? id(revision) : null,
});
const ver = (
  name: string,
  nodeName: string,
  children: string[] = [],
  commitVersion = 1,
) => ({
  id: id(name),
  nodeId: id(nodeName),
  title: nodeName,
  summary: 'Navigation summary',
  keywords: [],
  children: children.map((c) => ({ nodeId: id(c), versionId: id(c + '-v') })),
  segment: null,
  warnings: [],
  model: 'regression',
  promptVersion: 'regression',
  commitVersion,
});

test('semantic partitions reject missing, overlapping and reordered passages', () => {
  expect(() =>
    validatePartition(
      [
        { firstUnit: 0, lastUnit: 2 },
        { firstUnit: 3, lastUnit: 5 },
      ],
      0,
      5,
    ),
  ).not.toThrow();
  for (const ranges of [
    [{ firstUnit: 0, lastUnit: 4 }],
    [{ firstUnit: 1, lastUnit: 5 }],
    [
      { firstUnit: 0, lastUnit: 3 },
      { firstUnit: 3, lastUnit: 5 },
    ],
    [
      { firstUnit: 3, lastUnit: 5 },
      { firstUnit: 0, lastUnit: 2 },
    ],
  ])
    expect(() => validatePartition(ranges, 0, 5)).toThrow();
});
test('source units preserve every exact character and image-only page with bounded inputs', () => {
  expect(sourceUnits(stage)).toHaveLength(3);
  expect(
    segmentContent(stage, 0, 2)
      .texts.map((t) => t.text)
      .join(''),
  ).toBe('A'.repeat(20001));
  expect(
    unitBlocks(stage).every(
      (b) =>
        b.reduce(
          (n, u) => n + u.textRefs.reduce((m, r) => m + r.last - r.first, 0),
          0,
        ) <= 10000,
    ),
  ).toBe(true);
  const pages = {
    ...stage,
    primitives: Array.from({ length: 9 }, (_, i) => ({
      id: id('page' + i),
      kind: 'image',
      assetId: id('asset' + i),
      locator: { kind: 'page', page: i + 1 },
    })),
    document: {
      units: Array.from({ length: 9 }, (_, i) => ({
        renderId: id('page' + i),
        textIds: [],
      })),
    },
  } as unknown as Stage;
  expect(unitBlocks(pages).map((b) => b.length)).toEqual([4, 4, 1]);
  expect(segmentContent(pages, 0, 8).images).toHaveLength(9);
});
test('snapshots retain old summaries and withdraw corrected source support', () => {
  const nodes = [
    node('project', 'project'),
    node('topic', 'topic', 'project'),
    node('source', 'source', null, 'revision'),
    node('leaf', 'segment', 'source', 'revision'),
  ].map((n) => ({ ...n, createdVersion: 1 }));
  const snapshot: OrganizationSnapshot = {
    version: 1,
    nodes,
    versions: [
      ver('project-v', 'project', ['topic']),
      ver('topic-v', 'topic', ['leaf']),
      ver('source-v', 'source', ['leaf']),
      ver('leaf-v', 'leaf'),
    ],
    admissions: [
      {
        uploadId: id('upload'),
        revisionId: id('revision'),
        commitVersion: 1,
        sourceTime: null,
      },
    ],
    commits: [],
  };
  expect(reduceOrganization(snapshot).projects).toHaveLength(1);
  snapshot.admissions.push({
    uploadId: id('upload'),
    revisionId: id('correction'),
    commitVersion: 2,
    sourceTime: null,
  });
  expect(reduceOrganization(snapshot).segments).toHaveLength(1);
  snapshot.version = 2;
  expect(reduceOrganization(snapshot).nodes).toHaveLength(0);
  expect(reduceOrganization(snapshot).all).toHaveLength(4);
});
test('publication rejects skipped coverage, cross-source children and future child pins', () => {
  const nodes = [
    node('source', 'source', null, 'revision'),
    node('leaf', 'segment', 'source', 'revision'),
  ];
  const versions = [
    ver('source-v', 'source', ['leaf']),
    {
      ...ver('leaf-v', 'leaf'),
      segment: {
        revisionId: id('revision'),
        firstUnit: 0,
        lastUnit: 2,
        unitSchemaVersion: 1 as const,
        contextOnly: false,
      },
    },
  ].map(({ commitVersion, ...v }) => v);
  const proposed = { nodes, versions };
  expect(() =>
    validateOrganization(proposed, [], [], [stage], new Set([stage.id])),
  ).not.toThrow();
  const skipped = structuredClone(proposed);
  skipped.versions[1].segment!.lastUnit = 1;
  expect(() =>
    validateOrganization(skipped, [], [], [stage], new Set([stage.id])),
  ).toThrow('coverage');
  const leaked = structuredClone(proposed);
  leaked.nodes[1].scopeId = id('other');
  expect(() =>
    validateOrganization(leaked, [], [], [stage], new Set([stage.id])),
  ).toThrow();
  const future = structuredClone(proposed);
  future.versions[0].children[0].versionId = id('future');
  expect(() =>
    validateOrganization(future, [], [], [stage], new Set([stage.id])),
  ).toThrow('pin');
});
