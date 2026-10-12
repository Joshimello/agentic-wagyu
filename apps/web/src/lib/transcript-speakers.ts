import type { Primitive, Stage } from './server/contracts';

export type TranscriptText = Extract<Primitive, { kind: 'text' }>;
export type TranscriptDraft = {
  primitiveId: string;
  text: string;
  speaker: string;
};
export type SpeakerReviewDraft = {
  suggestionId: string;
  decision: 'confirmed' | 'rejected';
};
export type SpeakerGroup = {
  key: string;
  originalSpeaker: string | null;
  speaker: string | null;
  turns: TranscriptText[];
};

export function speakerConfirmationMatches(
  suggestion: NonNullable<Stage['speakerSuggestions']>[number],
  texts: TranscriptText[],
  drafts: ReadonlyMap<string, TranscriptDraft>,
) {
  const byId = new Map(texts.map((text) => [text.id, text]));
  const voiceIds = new Set(
    suggestion.voiceTranscriptIds ?? suggestion.transcriptIds,
  );
  return suggestion.transcriptIds.every((id) => {
    const text = byId.get(id);
    const draft = drafts.get(id);
    if (!text || !draft || draft.text !== text.text) return false;
    const sourceSpeaker =
      text.originalSpeaker !== undefined ? text.originalSpeaker : text.speaker;
    return (
      !voiceIds.has(id) ||
      sourceSpeaker !== suggestion.speaker ||
      draft.speaker.trim() === suggestion.candidateName
    );
  });
}

export function speakerGroups(texts: TranscriptText[]): SpeakerGroup[] {
  const groups = new Map<string, SpeakerGroup>();
  for (const text of texts) {
    if (text.role !== 'asr') continue;
    const originalSpeaker =
      text.originalSpeaker !== undefined ? text.originalSpeaker : text.speaker;
    // Unlabeled turns have no shared voice identity, so review them individually.
    const key =
      originalSpeaker === null
        ? text.id
        : JSON.stringify([originalSpeaker, text.speaker]);
    let group = groups.get(key);
    if (!group) {
      group = { key, originalSpeaker, speaker: text.speaker, turns: [] };
      groups.set(key, group);
    }
    group.turns.push(text);
  }
  return [...groups.values()];
}

export function nameSpeakerTurns(
  drafts: TranscriptDraft[],
  group: SpeakerGroup,
  name: string,
) {
  const ids = new Set(group.turns.map((p) => p.id));
  return drafts.map((draft) =>
    ids.has(draft.primitiveId) ? { ...draft, speaker: name.trim() } : draft,
  );
}
