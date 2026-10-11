import { z } from 'zod';
import { id, type Stage } from './index';

export const summaryPromptVersion = 'meeting-summary-1';
const evidence = z.array(id).min(1).max(12);
const point = z
  .object({ text: z.string().trim().min(1).max(1800), evidenceIds: evidence })
  .strict();
export const meetingSummary = z
  .object({
    overview: point,
    highlights: z.array(point).max(8),
    topics: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            kind: z.enum(['project', 'topic']),
            summary: z.string().trim().min(1).max(1200),
            evidenceIds: evidence,
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type MeetingSummary = z.infer<typeof meetingSummary>;
export type SummaryStatus = {
  id: string | null;
  revisionId: string;
  state:
    'not_requested' | 'queued' | 'processing' | 'ready' | 'failed' | 'canceled';
  progressPercent: number;
  generation: number;
  summary: MeetingSummary | null;
  error: string | null;
};
export function validateSummary(
  value: unknown,
  allowedIds: ReadonlySet<string>,
): MeetingSummary {
  const result = meetingSummary.parse(value);
  const ids = [result.overview, ...result.highlights, ...result.topics].flatMap(
    (item) => item.evidenceIds,
  );
  if (ids.some((id) => !allowedIds.has(id)))
    throw new Error('Summary cites text outside its reviewed source');
  if (
    new Set(
      result.topics.map((topic) =>
        topic.title.toLowerCase().replace(/\s+/g, ' ').trim(),
      ),
    ).size !== result.topics.length
  )
    throw new Error('Summary repeats a topic');
  return result;
}
export function hasMeetingSpeech(stage: Stage) {
  return (
    !stage.document &&
    stage.primitives.some(
      (p) => p.kind === 'text' && p.role === 'asr' && p.text.trim(),
    )
  );
}
