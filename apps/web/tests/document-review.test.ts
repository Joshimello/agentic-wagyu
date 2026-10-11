import { test, expect } from 'bun:test';
import {
  enrichDocument,
  plainSummary,
} from '../src/lib/server/agents/interpreter/document-review';
import { validateStage, type Stage } from '../src/lib/server/contracts';
import type { llmClient } from '../src/lib/server/llm/client';
import { exportMarkdown } from '../src/lib/server/services/staging';

function document(format: 'pptx' | 'pdf' = 'pptx', count = 5): Stage {
  const stage: Stage = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    rawAssetId: crypto.randomUUID(),
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      label: 'Source',
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      sourceTime: null,
      sourceTimeOrigin: 'unknown',
    },
    primitives: [],
    annotations: [],
    coverage: { complete: true, durationMs: null, warnings: [] },
    provenance: {
      adapter: 'documents-3',
      model: null,
      modelRevision: null,
      promptVersion: null,
    },
    document: {
      format,
      units: [],
      media: [],
      tools: {},
      transform: null,
      elapsedMs: 1,
      cached: false,
    },
  };
  for (let n = 1; n <= count; n++) {
    const renderId = crypto.randomUUID(),
      textId = crypto.randomUUID();
    const locator =
      format === 'pptx'
        ? { kind: 'slide' as const, slide: n }
        : { kind: 'page' as const, page: n };
    stage.primitives.push(
      {
        id: renderId,
        kind: 'image',
        role: format === 'pptx' ? 'slide' : 'page',
        assetId: crypto.randomUUID(),
        locator,
        actualMs: null,
        requestedMs: null,
      },
      {
        id: textId,
        kind: 'text',
        role: 'native',
        text: 'Native 简体 text stays untouched',
        speaker: null,
        locator,
      },
    );
    stage.document!.units.push({
      number: n,
      width: 100,
      height: 100,
      hidden: false,
      complete: true,
      warnings: [],
      renderId,
      textIds: [textId],
      mediaIds: [],
    });
  }
  if (format === 'pptx') {
    const id = crypto.randomUUID(),
      previewId = crypto.randomUUID();
    stage.document!.media!.push({
      id,
      kind: 'video',
      assetId: crypto.randomUUID(),
      sourcePart: 'ppt/media/video1.mp4',
      unitNumbers: [2],
      previewSourceUnit: 2,
      previewOrigin: 'video_frames',
      previewIds: [previewId],
      durationMs: 2000,
      warnings: ['Sampled frames; audio is not interpreted.'],
    });
    stage.document!.units[1].mediaIds = [id];
    stage.primitives.push({
      id: previewId,
      kind: 'image',
      role: 'embedded_frame',
      assetId: crypto.randomUUID(),
      locator: { kind: 'slide', slide: 2 },
      actualMs: 1000,
      requestedMs: 1000,
    });
  }
  return stage;
}
test('plain summaries display paragraph breaks and keep machine citation codes outside the prose', () => {
  expect(
    plainSummary(
      'Research comparison [U1, U2].\\n\\nMethods remain provisional [U9].',
    ),
  ).toBe('Research comparison.\n\nMethods remain provisional.');
});

test('canceling document review stops model requests without validation retries', async () => {
  const controller = new AbortController();
  let calls = 0;
  const llm = {
    model: 'document-cancellation-regression',
    client: {
      chat: {
        completions: {
          create: async (_input: unknown, options: { signal: AbortSignal }) => {
            calls++;
            expect(options.signal).toBe(controller.signal);
            controller.abort(new Error('User canceled'));
            throw new Error('Request aborted');
          },
        },
      },
    },
  } as unknown as ReturnType<typeof llmClient>;
  await expect(
    enrichDocument(
      document('pdf', 1),
      'cancel-regression-unused',
      async () => {},
      llm,
      async () => ({
        sha256: 'cancel-frame',
        url: 'data:image/jpeg;base64,YQ==',
      }),
      controller.signal,
    ),
  ).rejects.toThrow('User canceled');
  expect(calls).toBe(1);
});
const image = async (id: string) => ({
  sha256: id,
  url: 'data:image/jpeg;base64,aGVsbG8=',
});
function provider(
  calls: any[],
  invent: boolean | ((ref: string) => boolean) = false,
) {
  return {
    model: 'test-qwen',
    client: {
      chat: {
        completions: {
          create: async (body: any) => {
            calls.push(body);
            const content = body.messages[1].content;
            const refs = content
              .filter((c: any) => c.type === 'text')
              .slice(1)
              .map((c: any) => c.text.split('\n')[0]);
            return {
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    content: JSON.stringify(
                      refs.length
                        ? {
                            labels: refs.map((ref: string) => ({
                              ref: (
                                typeof invent === 'function'
                                  ? invent(ref)
                                  : invent
                              )
                                ? 'U999'
                                : ref,
                              label: 'Visual research comparison',
                              description:
                                'Source content describes a comparison of 简体 methods.',
                            })),
                          }
                        : {
                            summary:
                              'The document presents a visual research comparison and its reported limitations.',
                            evidenceRefs: [invent ? 'U999' : 'U5', 'U2'],
                          },
                    ),
                  },
                },
              ],
            };
          },
        },
      },
    },
  } as unknown as ReturnType<typeof llmClient>;
}
test('whole-document review reads every visual unit and media, remaps cached citations, and preserves native evidence', async () => {
  const stage = document(),
    calls: any[] = [],
    source = `assets/ab/${crypto.randomUUID()}`;
  await enrichDocument(stage, source, undefined, provider(calls), image);
  expect(calls).toHaveLength(4); // Two page batches, one video batch and one synthesis.
  expect(stage.document!.review!.unitsRead).toEqual([1, 2, 3, 4, 5]);
  expect(stage.document!.review!.mediaRead).toEqual([
    stage.document!.media![0].id,
  ]);
  expect(stage.document!.review!.complete).toBe(true);
  expect(validateStage(stage)).toEqual(stage);
  expect(stage.document!.review!.unitLabels[0].description).toContain('簡體');
  expect(
    stage.primitives.some((p) => p.kind === 'text' && p.text.includes('简体')),
  ).toBe(true);
  expect(exportMarkdown(stage, 'source.pptx', 'http://local')).toContain(
    'Document summary',
  );
  expect(exportMarkdown(stage, 'source.pptx', 'http://local')).toContain(
    'ppt/media/video1.mp4',
  );
  const replay = structuredClone(stage);
  for (const primitive of replay.primitives) {
    const oldId = primitive.id,
      nextId = crypto.randomUUID();
    primitive.id = nextId;
    for (const unit of replay.document!.units) {
      if (unit.renderId === oldId) unit.renderId = nextId;
      unit.textIds = unit.textIds.map((id) => (id === oldId ? nextId : id));
    }
    for (const media of replay.document!.media!)
      media.previewIds = media.previewIds.map((id) =>
        id === oldId ? nextId : id,
      );
  }
  // A stable image hash represents unchanged content across new primitive IDs.
  const hashes = new Map(
    stage.primitives
      .filter((p) => p.kind === 'image')
      .map((p) => [p.assetId, p.id]),
  );
  const resolve = async (id: string) =>
    image(
      hashes.get((replay.primitives.find((p) => p.id === id) as any).assetId)!,
    );
  await enrichDocument(replay, source, undefined, provider(calls), resolve);
  expect(calls).toHaveLength(4);
  expect(validateStage(replay)).toEqual(replay);
  expect(replay.document!.review!.summary!.evidenceIds).not.toContain(
    stage.document!.units[4].renderId,
  );
  for (const mutate of [
    (s: Stage) => {
      s.document!.review!.summary!.evidenceIds = [crypto.randomUUID()];
    },
    (s: Stage) => {
      s.document!.media![0].unitNumbers = [1];
    },
    (s: Stage) => {
      s.document!.review!.unitsRead.pop();
    },
  ]) {
    const invalid = structuredClone(stage);
    mutate(invalid);
    expect(() => validateStage(invalid)).toThrow();
  }
});
test('PDF review sends images without native text and cites page renders', async () => {
  const stage = document('pdf'),
    calls: any[] = [];
  await enrichDocument(
    stage,
    `assets/ab/${crypto.randomUUID()}`,
    undefined,
    provider(calls),
    image,
  );
  expect(JSON.stringify(calls)).not.toContain('Native 简体');
  expect(
    calls
      .slice(0, 2)
      .flatMap((c) =>
        c.messages[1].content.filter((p: any) => p.type === 'image_url'),
      ),
  ).toHaveLength(5);
  expect(stage.document!.review!.summary!.evidenceIds).toEqual([
    stage.document!.units[4].renderId,
    stage.document!.units[1].renderId,
  ]);
  expect(validateStage(stage)).toEqual(stage);
});
test('video batches bound image input and labels do not cite text omitted from the model context', async () => {
  const stage = document(),
    media = stage.document!.media![0];
  const firstText = stage.primitives.find(
    (p) => p.id === stage.document!.units[0].textIds[0],
  );
  if (firstText?.kind === 'text')
    firstText.text = 'OMITTED_NATIVE_BLOCK' + 'x'.repeat(11000);
  const frame = stage.primitives.find((p) => p.id === media.previewIds[0])!;
  for (let n = 0; n < 3; n++) {
    const p = {
      ...frame,
      id: crypto.randomUUID(),
      assetId: crypto.randomUUID(),
    };
    stage.primitives.push(p);
    media.previewIds.push(p.id);
  }
  const second = {
    ...media,
    id: crypto.randomUUID(),
    sourcePart: 'ppt/media/video2.mp4',
    assetId: crypto.randomUUID(),
    previewIds: [] as string[],
  };
  for (const ref of media.previewIds) {
    const p = {
      ...stage.primitives.find((p) => p.id === ref)!,
      id: crypto.randomUUID(),
      assetId: crypto.randomUUID(),
    };
    stage.primitives.push(p);
    second.previewIds.push(p.id);
  }
  stage.document!.media!.push(second);
  stage.document!.units[1].mediaIds!.push(second.id);
  const calls: any[] = [];
  await enrichDocument(
    stage,
    `assets/ab/${crypto.randomUUID()}`,
    undefined,
    provider(calls),
    image,
  );
  const visualCalls = calls.filter((c) =>
    c.messages[1].content.some((p: any) => p.type === 'image_url'),
  );
  expect(
    visualCalls.map(
      (c) =>
        c.messages[1].content.filter((p: any) => p.type === 'image_url').length,
    ),
  ).toEqual([4, 1, 4, 4]);
  expect(JSON.stringify(calls)).not.toContain('OMITTED_NATIVE_BLOCK');
  expect(stage.document!.review!.unitLabels[0].evidenceIds).toEqual([
    stage.document!.units[0].renderId,
  ]);
  expect(validateStage(stage)).toEqual(stage);
});
test('summary retry restates the citation limit instead of silently discarding excess references', async () => {
  const stage = document('pdf'),
    calls: any[] = [],
    baseline = provider(calls);
  let summaries = 0;
  const create = baseline.client.chat.completions.create.bind(
    baseline.client.chat.completions,
  );
  baseline.client.chat.completions.create = (async (body: any) => {
    if (body.messages[1].content.some((p: any) => p.type === 'image_url'))
      return create(body);
    summaries++;
    if (summaries === 2)
      expect(body.messages[1].content.at(-1).text).toContain(
        'between 1 and 12 distinct',
      );
    return {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              summary:
                'The document presents research comparisons and source-reported limitations.',
              evidenceRefs:
                summaries === 1
                  ? Array.from({ length: 13 }, () => 'U1')
                  : ['U1', 'U5'],
            }),
          },
        },
      ],
    };
  }) as any;
  await enrichDocument(
    stage,
    `assets/ab/${crypto.randomUUID()}`,
    undefined,
    baseline,
    image,
  );
  expect(summaries).toBe(2);
  expect(stage.document!.review!.complete).toBe(true);
  expect(stage.document!.review!.summary!.evidenceIds).toEqual([
    stage.document!.units[0].renderId,
    stage.document!.units[4].renderId,
  ]);
  expect(validateStage(stage)).toEqual(stage);
});
test('invented item references are retried and left unavailable without changing source coverage', async () => {
  const stage = document('pdf'),
    calls: any[] = [];
  await enrichDocument(
    stage,
    `assets/ab/${crypto.randomUUID()}`,
    undefined,
    provider(calls, true),
    image,
  );
  expect(calls).toHaveLength(4);
  expect(stage.document!.review!.summary).toBeNull();
  expect(stage.document!.review!.complete).toBe(false);
  expect(stage.document!.review!.warnings).toHaveLength(3);
  expect(stage.coverage.complete).toBe(true);
  expect(validateStage(stage)).toEqual(stage);
});
test('a serving outage stops remaining model work and publishes source evidence with an explicit deferred review', async () => {
  const stage = document('pdf');
  let calls = 0;
  const unavailable = {
    model: 'outage',
    client: {
      chat: {
        completions: {
          create: async () => {
            calls++;
            throw Object.assign(new Error('Unavailable'), { status: 500 });
          },
        },
      },
    },
  } as unknown as ReturnType<typeof llmClient>;
  await enrichDocument(
    stage,
    `assets/ab/${crypto.randomUUID()}`,
    undefined,
    unavailable,
    image,
  );
  expect(calls).toBe(4);
  expect(stage.document!.review!.summary).toBeNull();
  expect(stage.document!.review!.warnings.join(' ')).toContain('HTTP 500');
  expect(stage.document!.review!.warnings.join(' ')).toContain(
    'serving backend recovers',
  );
  expect(validateStage(stage)).toEqual(stage);
});
test('a serving outage still restores later successful checkpoints instead of losing partial reading coverage', async () => {
  const stage = document('pdf', 10),
    key = `assets/ab/${crypto.randomUUID()}`;
  const client = provider([], (ref) => Number(ref.slice(1)) < 9);
  await enrichDocument(stage, key, undefined, client, image);
  expect(stage.document!.review!.unitsRead).toEqual([9, 10]);
  let calls = 0;
  client.client.chat.completions.create = (async () => {
    calls++;
    throw Object.assign(new Error('Unavailable'), { status: 500 });
  }) as any;
  await enrichDocument(stage, key, undefined, client, image);
  expect(calls).toBe(4);
  expect(stage.document!.review!.unitsRead).toEqual([9, 10]);
  expect(validateStage(stage)).toEqual(stage);
});

function imageDocument() {
  const stage = document();
  const media = stage.document!.media![0];
  media.kind = 'image';
  media.sourcePart = 'ppt/media/image1.png';
  media.previewOrigin = 'decoded_image';
  media.durationMs = null;
  media.warnings = [];
  const preview = stage.primitives.find((p) => p.id === media.previewIds[0])!;
  if (preview.kind === 'image') {
    preview.role = 'figure';
    preview.requestedMs = null;
    preview.actualMs = null;
  }
  return stage;
}
test('boilerplate is recorded without prose, omitted from summaries, and retained as source evidence', async () => {
  const stage = imageDocument(),
    calls: any[] = [],
    baseline = provider(calls);
  const source = structuredClone(stage.document!.media);
  const create = baseline.client.chat.completions.create.bind(
    baseline.client.chat.completions,
  );
  baseline.client.chat.completions.create = (async (body: any) => {
    if (
      body.messages[1].content[0].text.includes('standalone boilerplate ONLY')
    ) {
      calls.push(body);
      return {
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                labels: [{ ref: 'M1', skipReason: 'classification_stamp' }],
              }),
            },
          },
        ],
      };
    }
    return create(body);
  }) as any;
  await enrichDocument(
    stage,
    `assets/ab/${crypto.randomUUID()}`,
    undefined,
    baseline,
    image,
  );
  expect(stage.document!.review!.mediaLabels).toEqual([]);
  expect(stage.document!.review!.skippedMedia).toEqual([
    {
      mediaId: source![0].id,
      reason: 'classification_stamp',
      evidenceIds: source![0].previewIds,
    },
  ]);
  expect(stage.document!.review!.complete).toBe(true);
  expect(stage.document!.media).toEqual(source);
  const summaryInput = calls.at(-1).messages[1].content[0].text;
  expect(summaryInput).toContain('"mediaObservations":""');
  const exported = exportMarkdown(stage, 'document.pptx', 'http://localhost');
  expect(exported).toContain('Boilerplate (classification_stamp)');
  expect(exported).not.toContain('No generated description available.');
  expect(validateStage(stage)).toEqual(stage);
  const contradictory = structuredClone(stage);
  contradictory.document!.review!.mediaLabels.push({
    mediaId: source![0].id,
    label: 'Contradictory label',
    description: 'Should be rejected.',
    evidenceIds: source![0].previewIds,
  });
  expect(() => validateStage(contradictory)).toThrow(
    'Media labels do not match reading coverage',
  );
});
test('identical decoded media shares one model decision with artifact-specific evidence', async () => {
  const stage = imageDocument(),
    original = stage.document!.media![0];
  const duplicate = {
    ...original,
    id: crypto.randomUUID(),
    assetId: crypto.randomUUID(),
    sourcePart: 'ppt/media/image2.png',
    previewIds: [crypto.randomUUID()],
  };
  const preview = stage.primitives.find(
    (p) => p.id === original.previewIds[0],
  )!;
  if (preview.kind !== 'image') throw new Error('Expected image preview');
  stage.primitives.push({
    ...preview,
    id: duplicate.previewIds[0],
    assetId: crypto.randomUUID(),
  });
  stage.document!.media!.push(duplicate);
  stage.document!.units[1].mediaIds!.push(duplicate.id);
  const calls: any[] = [];
  await enrichDocument(
    stage,
    `assets/ab/${crypto.randomUUID()}`,
    undefined,
    provider(calls),
    async (id) => ({
      sha256: [...original.previewIds, ...duplicate.previewIds].includes(id)
        ? 'same-decoded-image'
        : id,
      url: 'data:image/jpeg;base64,aGVsbG8=',
    }),
  );
  const mediaCalls = calls.filter((c) =>
    c.messages[1].content[0].text.includes('standalone boilerplate ONLY'),
  );
  expect(mediaCalls).toHaveLength(1);
  expect(
    mediaCalls[0].messages[1].content.filter(
      (p: any) => p.type === 'image_url',
    ),
  ).toHaveLength(1);
  expect(stage.document!.review!.mediaLabels.map((l) => l.evidenceIds)).toEqual(
    [original.previewIds, duplicate.previewIds],
  );
  expect(stage.document!.review!.complete).toBe(true);
  expect(validateStage(stage)).toEqual(stage);
});
test('videos cannot be skipped as boilerplate and unresolved decisions leave honest coverage', async () => {
  const stage = document(),
    baseline = provider([]),
    create = baseline.client.chat.completions.create.bind(
      baseline.client.chat.completions,
    );
  stage.document!.media![0].kind = 'video';
  baseline.client.chat.completions.create = (async (body: any) => {
    if (
      body.messages[1].content[0].text.includes('standalone boilerplate ONLY')
    )
      return {
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                labels: [{ ref: 'M1', skipReason: 'logo' }],
              }),
            },
          },
        ],
      };
    return create(body);
  }) as any;
  await enrichDocument(
    stage,
    `assets/ab/${crypto.randomUUID()}`,
    undefined,
    baseline,
    image,
  );
  expect(stage.document!.review!.mediaRead).toEqual([]);
  expect(stage.document!.review!.skippedMedia).toEqual([]);
  expect(stage.document!.review!.complete).toBe(false);
  expect(stage.document!.review!.warnings.length).toBeGreaterThan(0);
  expect(validateStage(stage)).toEqual(stage);
});
