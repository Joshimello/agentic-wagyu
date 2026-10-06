import { test, expect } from 'bun:test';
import { validateStage, type Stage } from '../src/lib/server/contracts';
import { applyTranscript } from '../src/lib/server/agents/interpreter/transcript';
import {
  normalizeTranscription,
  traditionalChinese,
} from '../src/lib/server/text-normalization';
function empty(): Stage {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    rawAssetId: crypto.randomUUID(),
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      sourceTime: null,
      label: 'video',
      sourceTimeOrigin: 'unknown',
    },
    primitives: [],
    annotations: [],
    coverage: { complete: true, durationMs: null, warnings: [] },
    provenance: {
      adapter: 'video',
      model: 'MOSS',
      modelRevision: 'pinned',
      promptVersion: 'visual-1',
    },
  };
}
const speech = {
  durationMs: 5000,
  segments: [
    {
      start: 1,
      end: 3,
      speaker: 'S01',
      text: 'Spoken words must stay separate.',
    },
  ],
  truncated: false,
  model: 'MOSS',
  revision: 'pinned',
};
test('truncated ASR preserves completed speech with explicit partial coverage', () => {
  const stage = empty();
  applyTranscript(stage, { ...speech, truncated: true });
  validateStage(stage);
  expect(stage.coverage.complete).toBe(false);
  expect(stage.coverage.warnings.join(' ')).toContain('trailing speech');
  expect(stage.primitives[0]).toMatchObject({
    kind: 'text',
    role: 'asr',
    text: speech.segments[0].text,
  });
  expect(stage.annotations).toEqual([]);
});
test('bad ASR intervals are omitted visibly rather than relocated into invented evidence', () => {
  const stage = empty();
  applyTranscript(stage, {
    ...speech,
    segments: [
      ...speech.segments,
      { start: 6, end: 7, speaker: 'S01', text: 'outside' },
    ],
  });
  validateStage(stage);
  expect(stage.primitives.length).toBe(1);
  expect(stage.coverage.complete).toBe(false);
  expect(stage.coverage.warnings.join(' ')).toContain('omitted');
});
test('empty timestamp output and merged anonymous speakers remain visible', () => {
  const none = empty();
  applyTranscript(none, { ...speech, segments: [] });
  expect(none.coverage.complete).toBe(false);
  const merged = empty();
  applyTranscript(merged, speech);
  expect(merged.coverage.warnings.join(' ')).toContain(
    'Speaker separation is unverified',
  );
});

test('OpenCC normalizes speech and preserves raw output, evidence IDs, time, English, and native text', () => {
  const stage = empty();
  const raw = {
    ...speech,
    segments: [
      {
        ...speech.segments[0],
        text: '我们介绍头发与发展。Qwen API v2: 30 min.',
      },
    ],
  };
  const original = structuredClone(raw);
  applyTranscript(stage, raw);
  expect(raw).toEqual(original);
  expect(stage.primitives[0]).toMatchObject({
    text: '我們介紹頭髮與發展。Qwen API v2: 30 min.',
    speaker: 'S01',
    locator: { startMs: 1000, endMs: 3000 },
  });
  expect(stage.provenance.textNormalization).toEqual({
    engine: 'opencc-js',
    version: '1.4.2',
    conversion: 's2t',
  });
  const normalized = structuredClone(stage.primitives[0]);
  if (normalized.kind !== 'text') throw new Error('Expected speech primitive');
  stage.primitives.push({
    ...normalized,
    id: crypto.randomUUID(),
    role: 'native',
    text: '原始文件简体内容',
  });
  normalizeTranscription(stage);
  expect(stage.primitives[0]).toEqual(normalized);
  expect(stage.primitives[1]).toMatchObject({ text: '原始文件简体内容' });
  expect(traditionalChinese('已經是繁體中文。')).toBe('已經是繁體中文。');
  validateStage(stage);
});
