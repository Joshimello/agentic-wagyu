import { test, expect } from 'bun:test';
import { validateStage, type Stage } from '../src/lib/server/contracts';
import { exportMarkdown } from '../src/lib/server/services/staging';
function fixture(): Stage {
  const image = crypto.randomUUID(),
    text = crypto.randomUUID(),
    notes = crypto.randomUUID();
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
      sourceTimeOrigin: 'unknown',
      label: 'Deck',
    },
    primitives: [
      {
        id: image,
        kind: 'image',
        role: 'slide',
        assetId: crypto.randomUUID(),
        requestedMs: null,
        actualMs: null,
        locator: { kind: 'slide', slide: 1 },
      },
      {
        id: text,
        kind: 'text',
        role: 'native',
        text: 'Native 简体 text preserved',
        speaker: null,
        locator: { kind: 'slide', slide: 1 },
      },
      {
        id: notes,
        kind: 'text',
        role: 'notes',
        text: 'Presenter notes, not spoken evidence',
        speaker: null,
        locator: { kind: 'slide', slide: 1 },
      },
    ],
    annotations: [],
    coverage: { complete: true, durationMs: null, warnings: [] },
    provenance: {
      adapter: 'documents-1',
      model: null,
      modelRevision: null,
      promptVersion: null,
    },
    document: {
      format: 'pptx',
      units: [
        {
          number: 1,
          hidden: true,
          width: 1800,
          height: 1000,
          textIds: [text, notes],
          renderId: image,
          complete: true,
          warnings: [],
        },
      ],
      tools: { renderer: 'pinned' },
      transform: null,
      elapsedMs: 100,
      cached: false,
    },
  };
}
test('documents pair native text and notes with their numbered source render and export distinct evidence roles', () => {
  const stage = fixture();
  expect(validateStage(stage)).toEqual(stage);
  const markdown = exportMarkdown(
    stage,
    'source.pptx',
    'http://localhost:5173',
  );
  expect(markdown).toContain('Slide 1 (hidden)');
  expect(markdown).toContain('Speaker notes (not spoken transcript)');
  expect(markdown).toContain('Native 简体 text preserved');
});
test('document validation refuses mismatched pages, missing renders, unassigned text and speech claims', () => {
  for (const mutate of [
    (s: Stage) => {
      s.document!.units[0].number = 2;
    },
    (s: Stage) => {
      s.document!.units[0].renderId = crypto.randomUUID();
    },
    (s: Stage) => {
      s.document!.units[0].textIds.pop();
    },
    (s: Stage) => {
      if (s.primitives[2].kind === 'text') s.primitives[2].role = 'asr';
    },
    (s: Stage) => {
      if (s.primitives[1].kind === 'text') s.primitives[1].speaker = 'Alice';
    },
    (s: Stage) => {
      s.document!.units[0].complete = false;
    },
  ]) {
    const stage = fixture();
    mutate(stage);
    expect(() => validateStage(stage)).toThrow();
  }
});
