import { test, expect } from 'bun:test';
import {
  enrichContext,
  transcriptBlocks,
  validateSearch,
} from '../src/lib/server/agents/interpreter/context';
import {
  validateStage,
  type Stage,
  type Primitive,
} from '../src/lib/server/contracts';
import type { llmClient } from '../src/lib/server/llm/client';
function speech(index: number): Extract<Primitive, { kind: 'text' }> {
  return {
    id: crypto.randomUUID(),
    kind: 'text',
    role: 'asr',
    speaker: 'S01',
    text: `我是小林，这是图中的比较方法 ${index}`,
    locator: {
      kind: 'media',
      timeline: 'container',
      startMs: index * 1000,
      endMs: index * 1000 + 500,
    },
  };
}
function stage(): Stage {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    rawAssetId: crypto.randomUUID(),
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      label: 'Context regression',
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      sourceTime: null,
      sourceTimeOrigin: 'unknown',
    },
    primitives: [speech(1), speech(2), speech(3)],
    annotations: [],
    coverage: { complete: true, durationMs: 500000, warnings: [] },
    provenance: {
      adapter: 'video',
      model: 'MOSS',
      modelRevision: 'pinned',
      promptVersion: null,
    },
  };
}
test('contiguous transcript reading covers every segment, including middle and final lines', () => {
  const lines = Array.from({ length: 1400 }, (_, i) => speech(i));
  const result = transcriptBlocks(lines, 900);
  expect(result.blocks.length).toBeGreaterThan(10);
  expect(result.blocks.flatMap((b) => b.refs)).toEqual(
    lines.map((_, i) => `T${i + 1}`),
  );
  expect(result.blocks.map((b) => b.content).join('')).toBe(
    result.lines.join('\n') + '\n',
  );
});
test('frame searches stay near cited speech and reject unrelated or invalid times', () => {
  expect(() => validateSearch([2000, 2500], [speech(2)], 500000)).not.toThrow();
  for (const times of [[400000], [-1], [2.5], [2000, 2000], [], [500000]])
    expect(() => validateSearch(times, [speech(2)], 500000)).toThrow();
});
test('context agent reads before searching and keeps names separate from unchanged speech', async () => {
  const value = stage(),
    original = structuredClone(
      value.primitives.filter((p) => p.kind === 'text'),
    );
  let calls = 0;
  const requests: any[] = [];
  const searches: number[][] = [];
  const client = {
    chat: {
      completions: {
        create: async (input: any) => {
          requests.push(structuredClone(input));
          calls++;
          if (calls === 1)
            return {
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: JSON.stringify({
                      questions: [
                        {
                          question: '图中比较的两种方法是什么？',
                          purpose: 'visual_context',
                          transcriptRefs: ['T2'],
                          priority: 1,
                        },
                      ],
                    }),
                  },
                },
              ],
            };
          if (calls === 2)
            return {
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'search',
                        type: 'function',
                        function: {
                          name: 'get_contact_sheet',
                          arguments: JSON.stringify({
                            timesMs: [2000],
                            reason: '查看发言所指的比较图',
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            };
          return {
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    annotations: [
                      {
                        text: '比较图标示 A 与 B。',
                        transcriptRefs: ['T2'],
                        frameRefs: ['F1'],
                      },
                    ],
                    speakerSuggestions: [
                      {
                        speakerRef: 'P1',
                        candidateName: '小林',
                        confidence: 'medium',
                        basis: 'self_introduction',
                        reason: '在引述发言中自我介绍。',
                        transcriptRefs: ['T2'],
                        frameRefs: [],
                      },
                    ],
                    unresolvedReason: '',
                  }),
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as ReturnType<typeof llmClient>['client'];
  await enrichContext(
    value,
    async (times) => {
      searches.push(times);
      return {
        image: 'data:image/jpeg;base64,AA==',
        frames: [
          {
            id: crypto.randomUUID(),
            kind: 'image',
            role: 'frame',
            assetId: crypto.randomUUID(),
            requestedMs: 2000,
            actualMs: 2040,
            locator: {
              kind: 'media',
              timeline: 'container',
              startMs: 2040,
              endMs: 2040,
            },
          },
        ],
      };
    },
    async () => {},
    { client, model: 'test-model' },
  );
  validateStage(value);
  expect(requests[0].messages[1].content).toContain('T3|');
  expect(searches).toEqual([[2000]]);
  expect(value.context).toMatchObject({ readSegments: 3, totalSegments: 3 });
  expect(value.context?.questions[0]).toMatchObject({
    status: 'answered',
    searches: [{ reason: '查看发言所指的比较图', timesMs: [2000] }],
  });
  expect(value.primitives.filter((p) => p.kind === 'text')).toEqual(original);
  expect(value.speakerSuggestions?.[0]).toMatchObject({
    speaker: 'S01',
    candidateName: '小林',
    transcriptIds: [original[1].id],
  });
  const invalid = structuredClone(value);
  invalid.speakerSuggestions![0].speaker = 'S99';
  expect(() => validateStage(invalid)).toThrow('lacks evidence');
  const missing = structuredClone(value);
  missing.context!.questions[0].searches[0].frameIds = [crypto.randomUUID()];
  expect(() => validateStage(missing)).toThrow('evidence');
});
