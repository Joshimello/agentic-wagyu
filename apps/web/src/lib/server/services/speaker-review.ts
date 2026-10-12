import { z } from 'zod';
import { id, type Stage } from '../contracts';
import { isUsableCandidateName } from '../../speaker-names';

export const speakerReviewEdit = z
  .object({
    suggestionId: id,
    decision: z.enum(['confirmed', 'rejected']),
  })
  .strict();

export type SpeakerReviewEdit = z.infer<typeof speakerReviewEdit>;

export function reviewSpeakerNames(
  stage: Stage,
  reviews: SpeakerReviewEdit[],
  changed: Set<string>,
  changedText: Set<string>,
) {
  if (!stage.speakerSuggestions && !reviews.length) return;
  const suggestions = stage.speakerSuggestions ?? [];
  const byId = new Map(stage.primitives.map((p) => [p.id, p]));
  if (new Set(reviews.map((r) => r.suggestionId)).size !== reviews.length)
    throw new Error('Duplicate speaker name review');
  for (const review of reviews) {
    const suggestion = suggestions.find((s) => s.id === review.suggestionId);
    if (!suggestion)
      throw new Error('Speaker name suggestion is no longer available');
    if (review.decision === 'confirmed') {
      const evidence = (
        suggestion.voiceTranscriptIds ?? suggestion.transcriptIds
      ).flatMap((ref) => {
        const p = byId.get(ref);
        return p?.kind === 'text' &&
          (p.originalSpeaker !== undefined ? p.originalSpeaker : p.speaker) ===
            suggestion.speaker
          ? [p]
          : [];
      });
      if (
        !evidence.length ||
        suggestion.transcriptIds.some((ref) => changedText.has(ref)) ||
        evidence.some((p) => p.speaker !== suggestion.candidateName)
      )
        throw new Error(
          'Apply the suggested name to its unchanged voice evidence before confirming',
        );
    }
    suggestion.review = review.decision;
  }
  stage.speakerSuggestions = suggestions.filter((s) => {
    if (
      !isUsableCandidateName(s.candidateName) ||
      s.transcriptIds.some((ref) => changedText.has(ref))
    )
      return false;
    if (!s.transcriptIds.some((ref) => changed.has(ref))) return true;
    if (s.review === 'rejected') return true;
    return (
      s.review === 'confirmed' &&
      (s.voiceTranscriptIds ?? s.transcriptIds).every((ref) => {
        const p = byId.get(ref);
        return (
          p?.kind === 'text' &&
          ((p.originalSpeaker !== undefined ? p.originalSpeaker : p.speaker) !==
            s.speaker ||
            p.speaker === s.candidateName)
        );
      })
    );
  });
  if (stage.speakerSuggestions.length < suggestions.length)
    stage.coverage.warnings.push(
      'Unsupported or outdated speaker name suggestions were removed; revisit visual context to review them.',
    );
}
