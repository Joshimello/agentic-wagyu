import type { Stage } from './contracts';

/** English reviews need an observation, not a bare T/F reference or timestamp. */
export function cleanEnglishReview(stage: Stage) {
  if (!stage.context?.promptVersion.endsWith('-en')) return;
  const before = stage.annotations.length;
  stage.annotations = stage.annotations.filter((a) =>
    /[A-Za-z]{3,}/.test(a.text),
  );
  const removed = before - stage.annotations.length;
  if (!removed) return;
  for (const question of stage.context.questions) {
    const observed = stage.annotations.some(
      (a) => a.questionId === question.id,
    );
    const named = stage.speakerSuggestions?.some(
      (s) =>
        s.review !== 'rejected' &&
        s.transcriptIds.some((ref) => question.transcriptIds.includes(ref)),
    );
    if (question.status === 'answered' && !observed && !named) {
      question.status = 'unresolved';
      question.explanation =
        'The response contained references without an English observation; speech and searched frames are preserved.';
    }
  }
  stage.coverage.warnings = stage.coverage.warnings.filter(
    (w) => !/^\d+ transcript context questions remain unresolved/.test(w),
  );
  stage.coverage.warnings.push(
    `${removed} visual annotations contained only references or no English prose and were omitted.`,
  );
  const unresolved = stage.context.questions.filter(
    (q) => q.status === 'unresolved',
  ).length;
  if (unresolved)
    stage.coverage.warnings.push(
      `${unresolved} transcript context questions remain unresolved; inspect the linked speech and searches.`,
    );
}
