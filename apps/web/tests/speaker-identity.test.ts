import { test, expect } from 'bun:test';
import {
  suggestSpeakerIdentities,
  identityTargets,
} from '../src/lib/server/agents/interpreter/speaker-identity';
import {
  validateStage,
  type Stage,
  type Primitive,
} from '../src/lib/server/contracts';
import { UsageBudgetExceeded } from '../src/lib/server/llm/usage';
import type { llmClient } from '../src/lib/server/llm/client';
function fixture(turns = 1): Stage {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    rawAssetId: crypto.randomUUID(),
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      label: 'Identity regression',
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      sourceTime: null,
      sourceTimeOrigin: 'unknown',
    },
    primitives: Array.from({ length: turns }, (_, i) => ({
      id: crypto.randomUUID(),
      kind: 'text' as const,
      role: 'asr' as const,
      speaker: `S01@window-${i + 1}`,
      text: 'My name is Ada. Here is my research.',
      locator: {
        kind: 'media' as const,
        timeline: 'container' as const,
        startMs: 1000 + i * 10000,
        endMs: 4000 + i * 10000,
      },
    })),
    annotations: [],
    coverage: { complete: true, durationMs: turns * 10000, warnings: [] },
    provenance: {
      adapter: 'regression',
      model: 'MOSS',
      modelRevision: null,
      promptVersion: null,
    },
  };
}
type Input = {
  voice: string;
  transcript: { ref: string; voice: string; text: string }[];
  frames: { ref: string }[];
};
function provider(result: (input: Input, call: number) => unknown) {
  const seen: Input[] = [];
  let calls = 0;
  const llm = {
    model: 'identity-regression',
    client: {
      chat: {
        completions: {
          create: async (request: {
            messages: { role: string; content: unknown }[];
          }) => {
            const input = JSON.parse(
              request.messages.find(
                (m) => m.role === 'user' && typeof m.content === 'string',
              )!.content as string,
            ) as Input;
            seen.push(input);
            const content = result(input, ++calls);
            return {
              choices: [
                {
                  message: { content: JSON.stringify(content) },
                  finish_reason: 'stop',
                },
              ],
            };
          },
        },
      },
    },
  } as unknown as ReturnType<typeof llmClient>;
  return { llm, seen, calls: () => calls };
}
const name = (ref = 'T1', overrides: Record<string, unknown> = {}) => ({
  name: 'Ada',
  confidence: 'high',
  basis: 'self_introduction',
  reason: 'Explicit introduction by this section-scoped voice.',
  transcriptRefs: [ref],
  frameRefs: [],
  identityQuote: 'My name is Ada.',
  activeSpeakerIndicator: false,
  ...overrides,
});
const noFrames = async () => {
  throw new Error('Unexpected frame request');
};
function frame(time = 1500): Primitive {
  return {
    id: crypto.randomUUID(),
    kind: 'image',
    role: 'frame',
    assetId: crypto.randomUUID(),
    actualMs: time,
    requestedMs: time,
    locator: {
      kind: 'media',
      timeline: 'container',
      startMs: time,
      endMs: time,
    },
  };
}

test('independent identity pass finds introductions with zero general context questions and never assigns names', async () => {
  const stage = fixture();
  stage.context = {
    model: 'regression',
    promptVersion: 'regression',
    readSegments: 1,
    totalSegments: 1,
    questions: [],
  };
  const original = structuredClone(stage.primitives);
  const mock = provider((_, call) =>
    call === 1
      ? { searches: [] }
      : { candidates: [name()], unresolvedReason: '' },
  );
  await suggestSpeakerIdentities(stage, noFrames, { llm: mock.llm });
  validateStage(stage);
  expect(stage.speakerSuggestions).toHaveLength(1);
  expect(stage.speakerSuggestions![0].candidateName).toBe('Ada');
  expect(stage.primitives).toEqual(original);
  expect(stage.context.questions).toEqual([]);
});
test('handoffs require preceding OTHER speech and cite the following TARGET voice', async () => {
  const stage = fixture(2);
  stage.primitives[0] = {
    ...stage.primitives[0],
    kind: 'text',
    role: 'asr',
    speaker: 'host',
    text: 'Next, over to Ada.',
    locator: stage.primitives[0].locator,
  };
  const second = stage.primitives[1];
  if (second.kind === 'text')
    second.text = 'Thanks. Here is the calibration work.';
  const mock = provider((input, call) =>
    call % 2 === 1
      ? { searches: [] }
      : {
          candidates:
            input.voice === 'host'
              ? []
              : [
                  name('T2', {
                    basis: 'handoff',
                    transcriptRefs: ['T1', 'T2'],
                    identityQuote: 'over to Ada.',
                  }),
                ],
          unresolvedReason: '',
        },
  );
  await suggestSpeakerIdentities(stage, noFrames, { llm: mock.llm });
  validateStage(stage);
  expect(stage.speakerSuggestions).toHaveLength(1);
  expect(stage.speakerSuggestions![0].voiceTranscriptIds).toEqual([second.id]);
});
test('active-speaker labels need searched frames and indicator evidence; participant lists are rejected', async () => {
  for (const active of [true, false]) {
    const stage = fixture();
    let searches = 0;
    const mock = provider((_, call) =>
      call === 1
        ? {
            searches: [
              { timesMs: [1500], reason: 'Inspect the active voice label.' },
            ],
          }
        : {
            candidates: [
              name('T1', {
                basis: 'speaker_indicator',
                frameRefs: ['F1'],
                identityQuote: 'Ada',
                activeSpeakerIndicator: active,
              }),
            ],
            unresolvedReason: '',
          },
    );
    await suggestSpeakerIdentities(
      stage,
      async () => {
        searches++;
        return { frames: [frame()], image: 'data:image/jpeg;base64,AA==' };
      },
      { llm: mock.llm },
    );
    validateStage(stage);
    expect(searches).toBe(1);
    expect(stage.speakerSuggestions?.length).toBe(active ? 1 : 0);
    expect(stage.speakerIdentity?.voices[0].status).toBe(
      active ? 'suggested' : 'failed',
    );
  }
});
test('mere name mentions with truthful quotations, invented transcript refs and unrelated searches cannot establish identity', async () => {
  for (const invalid of ['mention', 'truthful-mention', 'ref', 'search']) {
    const stage = fixture();
    if (stage.primitives[0].kind === 'text')
      stage.primitives[0].text = 'Ada wrote the related paper.';
    const mock = provider((_, call) =>
      call === 1
        ? {
            searches:
              invalid === 'search'
                ? [{ timesMs: [99999], reason: 'Unrelated' }]
                : [],
          }
        : {
            candidates: [
              name(
                invalid === 'ref' ? 'T99' : 'T1',
                invalid === 'truthful-mention'
                  ? { identityQuote: 'Ada wrote the related paper.' }
                  : {},
              ),
            ],
            unresolvedReason: '',
          },
    );
    await suggestSpeakerIdentities(stage, noFrames, { llm: mock.llm });
    expect(stage.speakerSuggestions).toEqual([]);
    expect(stage.coverage.warnings.join(' ')).toContain('analysis failed');
  }
});
test('an ordinary preceding name mention cannot be mislabeled as a handoff', async () => {
  const stage = fixture(2);
  if (stage.primitives[0].kind === 'text')
    stage.primitives[0].text = 'Ada wrote the related paper.';
  const mock = provider((input, call) =>
    call % 2 === 1
      ? { searches: [] }
      : {
          candidates:
            input.voice === 'S01@window-1'
              ? []
              : [
                  name('T2', {
                    basis: 'handoff',
                    transcriptRefs: ['T1', 'T2'],
                    identityQuote: 'Ada wrote the related paper.',
                  }),
                ],
          unresolvedReason: '',
        },
  );
  await suggestSpeakerIdentities(stage, noFrames, { llm: mock.llm });
  expect(stage.speakerSuggestions).toEqual([]);
});
test('legacy pending guesses are replaced by the independent pass while reviewed names remain', async () => {
  const stage = fixture();
  stage.speakerSuggestions = [
    {
      id: crypto.randomUUID(),
      speaker: 'S01@window-1',
      candidateName: 'Mentioned name',
      confidence: 'low',
      basis: 'contextual_guess',
      reason: 'Legacy guess',
      transcriptIds: [stage.primitives[0].id],
      frameIds: [],
      model: 'old',
      promptVersion: 'context-5-speaker-review-en',
    },
  ];
  const mock = provider((_, call) =>
    call === 1
      ? { searches: [] }
      : {
          candidates: [],
          unresolvedReason: 'No name attributable to this voice.',
        },
  );
  await suggestSpeakerIdentities(stage, noFrames, { llm: mock.llm });
  expect(stage.speakerSuggestions).toEqual([]);
});
test('conflicting introductions are retained as tentative and manual corrections and review decisions survive revisits', async () => {
  const stage = fixture();
  const p = stage.primitives[0];
  if (p.kind === 'text') {
    p.originalSpeaker = p.speaker;
    p.speaker = 'Manual name';
    p.text = 'My name is Ada. My name is Bea.';
  }
  const reviewed = {
    id: crypto.randomUUID(),
    speaker: 'S01@window-1',
    candidateName: 'Rejected name',
    confidence: 'low' as const,
    basis: 'handoff' as const,
    reason: 'Earlier review.',
    transcriptIds: [p.id],
    voiceTranscriptIds: [p.id],
    frameIds: [],
    model: 'earlier',
    promptVersion: 'earlier',
    review: 'rejected' as const,
  };
  stage.speakerSuggestions = [reviewed];
  const manual = structuredClone(stage.primitives);
  const mock = provider((_, call) =>
    call % 2 === 1
      ? { searches: [] }
      : {
          candidates: [
            name(),
            name('T1', { name: 'Bea', identityQuote: 'My name is Bea.' }),
          ],
          unresolvedReason:
            'Conflicting introductions require human confirmation.',
        },
  );
  await suggestSpeakerIdentities(stage, noFrames, { llm: mock.llm });
  await suggestSpeakerIdentities(stage, noFrames, { llm: mock.llm });
  validateStage(stage);
  expect(stage.primitives).toEqual(manual);
  expect(stage.speakerSuggestions).toHaveLength(3);
  expect(stage.speakerSuggestions![0]).toEqual(reviewed);
  expect(stage.speakerSuggestions!.slice(1).every((s) => !s.review)).toBe(true);
});
test('24 voice budget keeps sections separate and revisits prioritize deferred voices', async () => {
  const stage = fixture(25);
  const mock = provider((_, call) =>
    call % 2 === 1
      ? { searches: [] }
      : { candidates: [], unresolvedReason: 'No attributable name.' },
  );
  await suggestSpeakerIdentities(stage, noFrames, { llm: mock.llm });
  expect(mock.calls()).toBe(48);
  expect(
    stage.speakerIdentity!.voices.filter((v) => v.status === 'deferred'),
  ).toHaveLength(1);
  expect(stage.speakerIdentity!.voices[24].speaker).toBe('S01@window-25');
  const revisit = provider((_, call) =>
    call % 2 === 1
      ? { searches: [] }
      : { candidates: [], unresolvedReason: 'No attributable name.' },
  );
  await suggestSpeakerIdentities(stage, noFrames, { llm: revisit.llm });
  expect(revisit.seen[0].voice).toBe('S01@window-25');
});
test('two four-frame searches are the hard limit and audit frame references remain valid', async () => {
  const stage = fixture();
  let searches = 0;
  const mock = provider((_, call) =>
    call === 1
      ? {
          searches: [
            { timesMs: [1000, 1500, 2000, 2500], reason: 'First labels' },
            { timesMs: [3000, 3500, 4000, 4500], reason: 'Second labels' },
          ],
        }
      : { candidates: [], unresolvedReason: 'No active identity label.' },
  );
  await suggestSpeakerIdentities(
    stage,
    async (times) => {
      searches++;
      return {
        frames: times.map((t) => frame(t)),
        image: 'data:image/jpeg;base64,AA==',
      };
    },
    { llm: mock.llm },
  );
  validateStage(stage);
  expect(searches).toBe(2);
  expect(
    stage.speakerIdentity!.voices[0].searches.flatMap((s) => s.frameIds),
  ).toHaveLength(8);
  const over = provider(() => ({
    searches: [
      { timesMs: [1000], reason: 'a' },
      { timesMs: [1500], reason: 'b' },
      { timesMs: [2000], reason: 'c' },
    ],
  }));
  await suggestSpeakerIdentities(stage, noFrames, { llm: over.llm });
  expect(stage.speakerIdentity!.voices[0].status).toBe('failed');
});
test('operation budget defers remaining voices and explicit cancellation propagates', async () => {
  const stage = fixture(3);
  const mock = provider(() => {
    throw new UsageBudgetExceeded('Operation model budget exceeded');
  });
  await suggestSpeakerIdentities(stage, noFrames, { llm: mock.llm });
  expect(mock.calls()).toBe(1);
  expect(
    stage.speakerIdentity!.voices.every((v) => v.status === 'deferred'),
  ).toBe(true);
  const controller = new AbortController();
  const canceled = provider(() => {
    controller.abort(new Error('Explicitly canceled'));
    throw new Error('Request aborted');
  });
  await expect(
    suggestSpeakerIdentities(fixture(), noFrames, {
      llm: canceled.llm,
      signal: controller.signal,
    }),
  ).rejects.toThrow('Explicitly canceled');
});
test('identity targets sample introductions, handoffs and representative turns without crossing the voice scope', () => {
  const stage = fixture(3);
  const speech = stage.primitives.filter(
    (p): p is Extract<Primitive, { kind: 'text' }> => p.kind === 'text',
  );
  expect(
    identityTargets(speech, [speech[1]]).some((t) => t.id === speech[1].id),
  ).toBe(true);
});
