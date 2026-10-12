import { test, expect } from 'bun:test';
import {
  enrichContext,
  transcriptBlocks,
  validateSearch,
  contextPromptVersion,
} from '../src/lib/server/agents/interpreter/context';
import {
  validateStage,
  type Stage,
  type Primitive,
} from '../src/lib/server/contracts';
import type { llmClient } from '../src/lib/server/llm/client';
import { cleanEnglishReview } from '../src/lib/server/review-language';
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

test('canceling a context request aborts its model call instead of becoming a warning or retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  const llm = {
    model: 'context-cancellation-regression',
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
    enrichContext(
      stage(),
      async () => {
        throw new Error('Unexpected frame request');
      },
      async () => {},
      llm,
      controller.signal,
    ),
  ).rejects.toThrow('Request aborted');
  expect(calls).toBe(1);
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
                          question:
                            'Which two methods does the diagram compare?',
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
                            reason:
                              'Inspect the comparison diagram cited in the speech.',
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
                        text: 'The comparison diagram labels A and B.',
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
                        reason:
                          'The cited speech contains a self-introduction.',
                        transcriptRefs: ['T2'],
                        frameRefs: [],
                      },
                      {
                        speakerRef: 'P99',
                        candidateName: 'unknown',
                        confidence: 'low',
                        basis: 'contextual_guess',
                        reason: 'No usable evidence',
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
  for (const request of requests)
    expect(request.messages[0].content).toContain(
      'Plan, reason, and organize your work in English.',
    );
  expect(requests[1].messages[0].content).not.toContain(
    'Use Chinese for Chinese speech',
  );
  expect(searches).toEqual([[2000]]);
  expect(value.context).toMatchObject({ readSegments: 3, totalSegments: 3 });
  expect(value.context?.questions[0]).toMatchObject({
    status: 'answered',
    searches: [
      {
        reason: 'Inspect the comparison diagram cited in the speech.',
        timesMs: [2000],
      },
    ],
  });
  expect(value.primitives.filter((p) => p.kind === 'text')).toEqual(original);
  expect(value.speakerSuggestions).toEqual([]);
  const missing = structuredClone(value);
  missing.context!.questions[0].searches[0].frameIds = [crypto.randomUUID()];
  expect(() => validateStage(missing)).toThrow('evidence');
});

test('speaker-name abstentions stay unnamed instead of becoming fake name guesses', async () => {
  const { isUsableCandidateName } = await import('../src/lib/speaker-names');
  for (const name of [
    null,
    '',
    'unknown',
    'unresolved',
    '（無法確定）',
    '无明确姓名线索',
    'N/A',
  ])
    expect(isUsableCandidateName(name)).toBe(false);
  for (const name of ['小林', '元浩', 'James Chu'])
    expect(isUsableCandidateName(name)).toBe(true);
});

test('citation-only visual output does not count as an English answer and retains its evidence', () => {
  const value = stage();
  const frame: Primitive = {
    id: crypto.randomUUID(),
    kind: 'image',
    role: 'frame',
    assetId: crypto.randomUUID(),
    requestedMs: 2000,
    actualMs: 2000,
    locator: {
      kind: 'media',
      timeline: 'container',
      startMs: 2000,
      endMs: 2000,
    },
  };
  value.primitives.push(frame);
  const questionId = crypto.randomUUID();
  value.context = {
    model: 'test-model',
    promptVersion: contextPromptVersion,
    readSegments: 3,
    totalSegments: 3,
    questions: [
      {
        id: questionId,
        question: 'Which method is shown?',
        purpose: 'visual_context',
        transcriptIds: [value.primitives[0].id],
        status: 'answered',
        explanation: '',
        searches: [
          {
            reason: 'Inspect the diagram.',
            timesMs: [2000],
            frameIds: [frame.id],
          },
        ],
      },
    ],
  };
  value.annotations = [
    {
      id: crypto.randomUUID(),
      text: 'T1-T2 (1000-2500)',
      transcriptIds: [value.primitives[0].id],
      frameIds: [frame.id],
      origin: 'model',
      model: 'test-model',
      promptVersion: contextPromptVersion,
      questionId,
    },
  ];
  cleanEnglishReview(value);
  validateStage(value);
  expect(value.annotations).toEqual([]);
  expect(value.context.questions[0].status).toBe('unresolved');
  expect(value.context.questions[0].searches[0].frameIds).toEqual([frame.id]);
  expect(value.primitives).toContainEqual(frame);
});

test('visual revisits keep rejected names scoped to their corrected voice and leave repeated rejected answers unresolved', async () => {
  const value = stage();
  const voices = value.primitives.filter((p) => p.kind === 'text');
  for (const p of voices) p.originalSpeaker = p.speaker;
  voices[0].speaker = voices[2].speaker = 'Bob';
  voices[1].speaker = 'Carol';
  const rejected = {
    id: crypto.randomUUID(),
    speaker: 'S01',
    candidateName: 'Alice',
    confidence: 'medium' as const,
    basis: 'handoff' as const,
    reason: 'Previously rejected introduction.',
    transcriptIds: [voices[0].id],
    voiceTranscriptIds: [voices[0].id],
    frameIds: [],
    model: 'test-model',
    promptVersion: contextPromptVersion,
    review: 'rejected' as const,
  };
  value.speakerSuggestions = [rejected];
  let answers = 0;
  const llm = {
    model: 'test-model',
    client: {
      chat: {
        completions: {
          create: async (request: {
            response_format?: { json_schema?: { name: string } };
          }) => {
            const planning =
              request.response_format?.json_schema?.name ===
              'context_questions';
            const content = planning
              ? {
                  questions: ['T1', 'T2'].map((ref, index) => ({
                    question: `Who is voice ${index + 1}?`,
                    purpose: 'speaker_identity',
                    transcriptRefs: [ref],
                    priority: 1,
                  })),
                }
              : {
                  annotations: [],
                  speakerSuggestions: [
                    {
                      speakerRef: `P${++answers}`,
                      candidateName: 'Alice',
                      confidence: 'medium',
                      basis: 'handoff',
                      reason: 'A handoff names the other speaker.',
                      transcriptRefs: ['T1', 'T2'],
                      frameRefs: [],
                    },
                  ],
                  unresolvedReason: '',
                };
            return {
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: JSON.stringify(content),
                  },
                },
              ],
            };
          },
        },
      },
    },
  } as unknown as ReturnType<typeof llmClient>;
  await enrichContext(
    value,
    async () => {
      throw new Error('No frames needed for this introduction');
    },
    async () => {},
    llm,
  );
  validateStage(value);
  expect(value.speakerSuggestions).toHaveLength(1);
  expect(value.speakerSuggestions?.[0]).toEqual(rejected);
  expect(answers).toBe(0);
  expect(value.context?.questions).toEqual([]);
});
