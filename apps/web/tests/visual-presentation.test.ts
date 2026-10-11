import { expect, test } from 'bun:test';
import type { Primitive, Stage } from '../src/lib/server/contracts';
import {
  formatObservation,
  galleryFrames,
  groupVisualObservations,
} from '../src/lib/visual-presentation';

function frame(
  id: string,
  assetId: string,
  actualMs: number,
): Extract<Primitive, { kind: 'image' }> {
  return {
    id,
    assetId,
    kind: 'image',
    role: 'frame',
    actualMs,
    requestedMs: actualMs + 200,
    locator: {
      kind: 'media',
      timeline: 'container',
      startMs: actualMs,
      endMs: actualMs,
    },
  };
}
function annotation(
  id: string,
  frameIds: string[],
  questionId?: string,
): Stage['annotations'][number] {
  return {
    id,
    frameIds,
    questionId,
    text: `Observation ${id}`,
    transcriptIds: ['speech'],
    origin: 'model',
    model: 'Qwen',
    promptVersion: 'context',
  };
}

test('explicit slide labels become headings while body and quoted pipeline meaning are retained', () => {
  const result = formatObservation(
    "Slide title: \"Projection\" \u2014 subtitle: \"Matching two views\"\n\nPipeline row of four yellow boxes: 'Project Panorama Into Fisheye (Using the calibrated lens model)' -> 'Find Matching Features with SIFT (Locate same feature/details in both)' -> 'Measure Pixel Shift' -> 'Group Angles From Lens Center (0\u00b0 = centre, 90\u00b0 = seam)'. This matches P1's T61-T62 description.",
  );
  expect(result.title).toBe('Projection');
  expect(result.subtitle).toBe('Matching two views');
  expect(result.blocks).toEqual([
    {
      kind: 'pipeline',
      introduction: 'Pipeline row of four yellow boxes',
      steps: [
        'Project Panorama Into Fisheye (Using the calibrated lens model)',
        'Find Matching Features with SIFT (Locate same feature/details in both)',
        'Measure Pixel Shift',
        'Group Angles From Lens Center (0\u00b0 = centre, 90\u00b0 = seam)',
      ],
      conclusion: "This matches P1's T61-T62 description.",
    },
  ]);
});

test('free-form text and HTML remain plain text, and unquoted arrows do not guess a pipeline', () => {
  const text =
    '<script>alert("x")</script> A -> B. A quoted "comparison" is important.';
  expect(formatObservation(text)).toEqual({
    title: null,
    subtitle: null,
    blocks: [{ kind: 'paragraph', text }],
  });
});

test('quoted slide subtitles keep source attribution separately without displaying wrapper quotes', () => {
  const formatted = formatObservation(
    "Slide title: 'Stitching Inconsistency Test' \u2014 subtitle: 'This test checks the seams' (CGVLab, slide 6).",
  );
  expect(formatted).toEqual({
    title: 'Stitching Inconsistency Test',
    subtitle: 'This test checks the seams',
    blocks: [{ kind: 'paragraph', text: '(CGVLab, slide 6).' }],
  });
});

test('explicit visual-description labels gain hierarchy while the evidence text remains intact', () => {
  expect(
    formatObservation(
      'Visual samples (bottom-left pair): Two circular fisheye images show the same room. The projected version has a visible seam.',
    ).blocks,
  ).toEqual([
    {
      kind: 'description',
      heading: 'Visual samples (bottom-left pair)',
      text: 'Two circular fisheye images show the same room. The projected version has a visible seam.',
    },
  ]);
});

test('deduplicate exact frame assets while retaining every primitive and actual/requested timestamp', () => {
  const a = frame('a', 'same', 1000),
    b = frame('b', 'same', 1300),
    c = frame('c', 'different', 1500);
  expect(galleryFrames([a, b, a, c])).toEqual([
    { assetId: 'same', sources: [a, b] },
    { assetId: 'different', sources: [c] },
  ]);
});

test('group shared question and exact assets transitively without merging nearby distinct images', () => {
  const primitives = [
    frame('a', 'asset-a', 1000),
    frame('b', 'asset-b', 1100),
    frame('c', 'asset-c', 1200),
    frame('d', 'asset-a', 1400),
  ];
  const annotations = [
    annotation('first', ['a'], 'q'),
    annotation('second', ['b'], 'q'),
    annotation('third', ['d']),
    annotation('separate', ['c']),
  ];
  const groups = groupVisualObservations({ annotations, primitives });
  expect(groups).toHaveLength(2);
  expect(groups[0].annotations.map((a) => a.id)).toEqual([
    'first',
    'second',
    'third',
  ]);
  expect(groups[0].frames.map((f) => f.assetId)).toEqual([
    'asset-a',
    'asset-b',
  ]);
  expect(groups[0].frames[0].sources.map((f) => f.id)).toEqual(['a', 'd']);
  expect(groups[1].frames.map((f) => f.assetId)).toEqual(['asset-c']);
});

test('duplicate wording displays once while all annotation and citation IDs remain accessible', () => {
  const first = annotation('first', ['a']),
    second = {
      ...annotation('second', ['b']),
      text: first.text,
      transcriptIds: ['other'],
    };
  const groups = groupVisualObservations({
    annotations: [first, second],
    primitives: [frame('a', 'same', 1000), frame('b', 'same', 2000)],
  });
  expect(groups[0].observations).toEqual([
    { text: first.text, annotations: [first, second] },
  ]);
  expect(groups[0].transcriptIds).toEqual(['speech', 'other']);
});

test('question search frames join the gallery and exact asset aliases keep their anchors', () => {
  const primitives = [
    frame('a', 'asset-a', 1000),
    frame('b', 'asset-b', 2000),
    frame('alias', 'asset-b', 2500),
  ];
  const groups = groupVisualObservations({
    annotations: [annotation('observation', ['a'], 'question')],
    primitives,
    context: {
      model: 'Qwen',
      promptVersion: 'context',
      readSegments: 1,
      totalSegments: 1,
      questions: [
        {
          id: 'question',
          question: 'What is the pipeline?',
          purpose: 'visual_context',
          status: 'answered',
          explanation: 'The source slide explains it.',
          transcriptIds: ['speech'],
          searches: [
            {
              reason: 'Inspect nearby frames',
              timesMs: [1000, 2000],
              frameIds: ['a', 'b'],
            },
          ],
        },
      ],
    },
  });
  expect(groups[0].frames.map((image) => image.assetId)).toEqual([
    'asset-a',
    'asset-b',
  ]);
  expect(groups[0].frames[1].sources.map((image) => image.id)).toEqual([
    'b',
    'alias',
  ]);
});
