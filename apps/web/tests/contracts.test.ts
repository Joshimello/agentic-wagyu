import { test, expect } from 'bun:test';
import {
  validateStage,
  validatePush,
  transition,
  assertReadScope,
  stageSchema,
  pushSchema,
  memorySchema,
  querySchema,
} from '../src/lib/server/contracts';
import { z } from 'zod';

const uuid = () => crypto.randomUUID();
export function sampleStage() {
  const frame = uuid(),
    transcript = uuid();
  return {
    schemaVersion: 1 as const,
    id: uuid(),
    uploadId: uuid(),
    rawAssetId: uuid(),
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      sourceTime: null,
      label: 'meeting',
      sourceTimeOrigin: 'unknown' as const,
    },
    primitives: [
      {
        id: transcript,
        kind: 'text' as const,
        role: 'asr' as const,
        text: 'The launch is Friday.',
        speaker: 'S01',
        locator: {
          kind: 'media' as const,
          timeline: 'container' as const,
          startMs: 0,
          endMs: 1000,
        },
      },
      {
        id: frame,
        kind: 'image' as const,
        role: 'frame' as const,
        assetId: uuid(),
        requestedMs: 500,
        actualMs: 520,
        locator: {
          kind: 'media' as const,
          timeline: 'container' as const,
          startMs: 520,
          endMs: 520,
        },
      },
    ],
    annotations: [
      {
        id: uuid(),
        text: 'Slide shows Friday.',
        transcriptIds: [transcript],
        frameIds: [frame],
        origin: 'model' as const,
        model: 'test',
        promptVersion: 'visual-1',
      },
    ],
    coverage: { complete: true, durationMs: 2000, warnings: [] as string[] },
    provenance: {
      adapter: 'video',
      model: 'MOSS',
      modelRevision: 'pinned',
      promptVersion: null,
    },
  };
}
test('typed staging preserves speech, visuals and exact container timestamps', () =>
  expect(validateStage(sampleStage()).primitives.length).toBe(2));
test('reject dangling references, duplicate primitives, reversed/outside intervals and unreported omissions', () => {
  const s = sampleStage();
  s.annotations[0].frameIds = [uuid()];
  expect(() => validateStage(s)).toThrow();
  const d = sampleStage();
  d.primitives.push(d.primitives[0]);
  expect(() => validateStage(d)).toThrow();
  const r = sampleStage();
  r.primitives[0].locator.endMs = 3000;
  expect(() => validateStage(r)).toThrow();
  const f = sampleStage();
  f.primitives[1].actualMs = 2000;
  expect(() => validateStage(f)).toThrow();
  const partial = sampleStage();
  partial.coverage.complete = false;
  expect(() => validateStage(partial)).toThrow();
});
test('push pins old revision even after correction; rejects missing revisions and unaccepted partials', () => {
  const old = sampleStage();
  const corrected = { ...old, id: uuid(), parentRevisionId: old.id };
  const p = {
    id: uuid(),
    idempotencyKey: 'click-1',
    createdAt: new Date().toISOString(),
    expectedMemoryVersion: 0,
    items: [
      { uploadId: old.uploadId, revisionId: old.id, acceptPartial: false },
    ],
  };
  expect(validatePush(p, [old, corrected]).items[0].revisionId).toBe(old.id);
  expect(() => validatePush(p, [corrected])).toThrow();
  old.coverage.complete = false;
  old.coverage.warnings = ['ASR truncated'];
  expect(() => validatePush(p, [old])).toThrow();
});
test('uploads and ready staging do not grant memory authority; snapshot excludes newer unpushed evidence', () => {
  const old = uuid(),
    newer = uuid();
  expect(() => assertReadScope(1, 1, old, new Set())).toThrow();
  expect(() => assertReadScope(1, 2, old, new Set([old]))).toThrow();
  expect(() => assertReadScope(1, 1, newer, new Set([old]))).toThrow();
  expect(() => assertReadScope(1, 1, old, new Set([old]))).not.toThrow();
});
test('job retries require explicit transitions and terminal publication cannot repeat', () => {
  expect(transition('queued', 'processing')).toBe('processing');
  expect(transition('failed', 'queued')).toBe('queued');
  expect(() => transition('ready', 'processing')).toThrow();
  expect(() => transition('queued', 'ready')).toThrow();
});
test('schemas remain portable JSON Schema with strict additional properties', () => {
  for (const schema of [stageSchema, pushSchema, memorySchema, querySchema])
    expect(z.toJSONSchema(schema).additionalProperties).toBe(false);
});
