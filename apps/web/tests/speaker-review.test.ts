import { expect, test } from 'bun:test';
import { validateStage, type Stage } from '../src/lib/server/contracts';
import {
  speakerGroups,
  nameSpeakerTurns,
  speakerConfirmationMatches,
} from '../src/lib/transcript-speakers';
import { reviewSpeakerNames } from '../src/lib/server/services/speaker-review';
import { sampleStage } from './contracts.test';
import { transcriptBlocks } from '../src/lib/server/agents/interpreter/context';
import { revisitContext } from '../src/lib/server/agents/interpreter/video';

function meeting() {
  const stage = validateStage(sampleStage());
  const voice = stage.primitives.find((p) => p.kind === 'text')!;
  if (voice.kind !== 'text') throw new Error('Missing speech');
  stage.primitives = Array.from({ length: 125 }, (_, index) => ({
    ...voice,
    id: crypto.randomUUID(),
    speaker: index % 2 ? 'Part 2 · S01' : 'Part 1 · S01',
  }));
  stage.annotations = [];
  return stage;
}

function suggestion(stage: Stage) {
  return {
    id: crypto.randomUUID(),
    speaker: 'Part 1 · S01',
    candidateName: 'Alice',
    confidence: 'medium' as const,
    basis: 'self_introduction' as const,
    reason: 'The speaker introduces themselves.',
    transcriptIds: [stage.primitives[0].id],
    frameIds: [],
    model: 'test-model',
    promptVersion: 'test-prompt',
  };
}

test('a speaker name applies beyond the visible page and leaves the other window and speech untouched', () => {
  const stage = meeting();
  const texts = stage.primitives.filter((p) => p.kind === 'text');
  const drafts = texts.map((p) => ({
    primitiveId: p.id,
    text: p.text,
    speaker: p.speaker ?? '',
  }));
  const groups = speakerGroups(texts);
  expect(groups).toHaveLength(2);
  const renamed = nameSpeakerTurns(drafts, groups[0], ' Alice ');
  expect(renamed.filter((p) => p.speaker === 'Alice')).toHaveLength(63);
  expect(renamed[124].speaker).toBe('Alice');
  expect(renamed[123].speaker).toBe('Part 2 · S01');
  expect(renamed.map((p) => p.text)).toEqual(drafts.map((p) => p.text));
  expect(drafts[0].speaker).toBe('Part 1 · S01');
});

test('saved names preserve section scopes and individual diarization corrections', () => {
  const stage = meeting();
  const texts = stage.primitives
    .filter((p) => p.kind === 'text')
    .map((p) => ({
      ...p,
      originalSpeaker: p.speaker,
      speaker: 'Alice',
    }));
  texts[0].speaker = 'Bob';
  const groups = speakerGroups(texts);
  expect(groups).toHaveLength(3);
  expect(groups[0].turns).toHaveLength(1);
  expect(groups[1].originalSpeaker).toBe('Part 2 · S01');
  expect(groups[2].originalSpeaker).toBe('Part 1 · S01');
  texts[0].originalSpeaker = null;
  texts[1].originalSpeaker = null;
  texts[0].speaker = texts[1].speaker = 'Alice';
  expect(
    speakerGroups(texts).filter((g) => g.originalSpeaker === null),
  ).toHaveLength(2);
});

test('confirmed names and rejected suggestions retain their voice evidence and validate in exports', () => {
  const stage = meeting();
  const accepted = suggestion(stage);
  const rejected = { ...suggestion(stage), candidateName: 'Bob' };
  stage.speakerSuggestions = [accepted, rejected];
  for (const p of stage.primitives)
    if (p.kind === 'text' && p.speaker === accepted.speaker) {
      p.originalSpeaker = p.speaker;
      p.speaker = accepted.candidateName;
    }
  reviewSpeakerNames(
    stage,
    [
      { suggestionId: accepted.id, decision: 'confirmed' },
      { suggestionId: rejected.id, decision: 'rejected' },
    ],
    new Set([stage.primitives[0].id]),
    new Set(),
  );
  expect(validateStage(stage).speakerSuggestions?.map((s) => s.review)).toEqual(
    ['confirmed', 'rejected'],
  );
  const wrong = structuredClone(stage);
  const first = wrong.primitives[0];
  if (first.kind === 'text') first.speaker = 'Bob';
  expect(() => validateStage(wrong)).toThrow('Confirmed speaker name differs');
});

test('missing, duplicate and unsupported confirmations cannot be saved', () => {
  const stage = meeting();
  const candidate = suggestion(stage);
  stage.speakerSuggestions = [candidate];
  const confirm = {
    suggestionId: candidate.id,
    decision: 'confirmed' as const,
  };
  expect(() =>
    reviewSpeakerNames(stage, [confirm], new Set(), new Set()),
  ).toThrow('Apply the suggested name');
  expect(() =>
    reviewSpeakerNames(
      stage,
      [{ ...confirm, suggestionId: crypto.randomUUID() }],
      new Set(),
      new Set(),
    ),
  ).toThrow('no longer available');
  expect(() =>
    reviewSpeakerNames(stage, [confirm, confirm], new Set(), new Set()),
  ).toThrow('Duplicate');
  const first = stage.primitives[0];
  if (first.kind === 'text') {
    first.originalSpeaker = first.speaker;
    first.speaker = 'Alice';
  }
  expect(() =>
    reviewSpeakerNames(
      stage,
      [confirm],
      new Set([first.id]),
      new Set([first.id]),
    ),
  ).toThrow('unchanged voice evidence');
});

test('correcting supporting speech invalidates even previously reviewed name suggestions', () => {
  const stage = meeting();
  stage.speakerSuggestions = [{ ...suggestion(stage), review: 'rejected' }];
  reviewSpeakerNames(
    stage,
    [],
    new Set([stage.primitives[0].id]),
    new Set([stage.primitives[0].id]),
  );
  expect(stage.speakerSuggestions).toEqual([]);
  expect(stage.coverage.warnings).toContain(
    'Unsupported or outdated speaker name suggestions were removed; revisit visual context to review them.',
  );
});

test('visual planning respects corrected voices while preserving their original section scopes', () => {
  const stage = meeting();
  const texts = stage.primitives.filter((p) => p.kind === 'text');
  for (const p of texts) {
    p.originalSpeaker = p.speaker;
    p.speaker = 'Alice';
  }
  texts[2].speaker = 'Bob';
  const blocks = transcriptBlocks(texts);
  expect(blocks.speakerRefs.get('T1')).not.toBe(blocks.speakerRefs.get('T2'));
  expect(blocks.speakerRefs.get('T1')).not.toBe(blocks.speakerRefs.get('T3'));
  expect(blocks.speakerRefs.get('T1')).toBe(blocks.speakerRefs.get('T5'));
  texts[0].speaker = texts[0].originalSpeaker!;
  texts[4].speaker = texts[4].originalSpeaker!;
  delete texts[4].originalSpeaker;
  const restored = transcriptBlocks(texts);
  expect(restored.speakerRefs.get('T1')).toBe(restored.speakerRefs.get('T5'));
});

test('a handoff can cite another corrected voice without assigning that voice the candidate name', () => {
  const stage = meeting();
  const first = stage.primitives[0],
    second = stage.primitives[2];
  if (first.kind !== 'text' || second.kind !== 'text')
    throw new Error('Missing voice');
  first.originalSpeaker = second.originalSpeaker = first.speaker;
  first.speaker = 'Alice';
  second.speaker = 'Bob';
  const candidate = {
    ...suggestion(stage),
    transcriptIds: [first.id, second.id],
    voiceTranscriptIds: [first.id],
  };
  stage.speakerSuggestions = [candidate];
  reviewSpeakerNames(
    stage,
    [{ suggestionId: candidate.id, decision: 'confirmed' }],
    new Set([first.id]),
    new Set(),
  );
  expect(validateStage(stage).speakerSuggestions?.[0].review).toBe('confirmed');
  const texts = stage.primitives.filter((p) => p.kind === 'text');
  const drafts = new Map(
    texts.map((p) => [
      p.id,
      { primitiveId: p.id, text: p.text, speaker: p.speaker ?? '' },
    ]),
  );
  expect(speakerConfirmationMatches(candidate, texts, drafts)).toBe(true);
  drafts.get(first.id)!.speaker = 'Carol';
  expect(speakerConfirmationMatches(candidate, texts, drafts)).toBe(false);
  drafts.get(first.id)!.speaker = 'Alice';
  drafts.get(second.id)!.text = 'Corrected contextual speech';
  expect(speakerConfirmationMatches(candidate, texts, drafts)).toBe(false);
  const invalid = structuredClone(stage);
  invalid.speakerSuggestions![0].voiceTranscriptIds = [crypto.randomUUID()];
  expect(() => validateStage(invalid)).toThrow();
});

test('a failed visual-only revisit preserves reviewed name decisions and cited frames', async () => {
  const stage = validateStage(sampleStage());
  const voice = stage.primitives[0];
  const frame = stage.primitives[1];
  if (voice.kind !== 'text' || frame.kind !== 'image')
    throw new Error('Missing evidence');
  stage.speakerSuggestions = [
    {
      ...suggestion(stage),
      speaker: voice.speaker!,
      frameIds: [frame.id],
      review: 'rejected',
    },
  ];
  const reviewed = structuredClone(stage.speakerSuggestions);
  const result = await revisitContext(stage, 'unused.mp4');
  expect(result.speakerSuggestions).toEqual(reviewed);
  expect(result.primitives.find((p) => p.id === frame.id)).toEqual(frame);
  expect(validateStage(result).speakerSuggestions).toEqual(reviewed);
});
