import { test, expect } from 'bun:test';
import { validateStage, type Stage } from '../src/lib/server/contracts';
import { applyTranscript } from '../src/lib/server/agents/interpreter/transcript';
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
