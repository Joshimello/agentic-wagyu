import { z } from 'zod';
import type { Stage } from '../../contracts';
import { normalizeTranscription } from '../../text-normalization';
export const asrSchema = z.object({
  durationMs: z.number().int().positive(),
  segments: z.array(
    z.object({
      start: z.number().finite().nonnegative(),
      end: z.number().finite().nonnegative(),
      speaker: z.string(),
      text: z.string(),
    }),
  ),
  truncated: z.boolean(),
  incomplete: z.boolean().optional(),
  model: z.string(),
  revision: z.string(),
  warnings: z.array(z.string()).optional(),
});
/** Keep partial speech inspectable while making omissions explicit. */
export function applyTranscript(stage: Stage, value: unknown) {
  const result = asrSchema.parse(value);
  const warnings = [...(result.warnings ?? [])];
  let complete = !result.incomplete;
  if (result.truncated) {
    warnings.push(
      'ASR output reached its token limit; trailing speech may be missing',
    );
    complete = false;
  }
  if (result.segments.length === 0) {
    warnings.push(
      'No timestamped speech was extracted; check the original audio',
    );
    complete = false;
  }
  if (new Set(result.segments.map((s) => s.speaker)).size === 1)
    warnings.push(
      'ASR returned one anonymous speaker. Speaker separation is unverified; correct labels if voices were merged.',
    );
  for (const s of result.segments) {
    const startMs = Math.round(s.start * 1000),
      endMs = Math.round(s.end * 1000);
    if (
      endMs < startMs ||
      startMs >= result.durationMs ||
      endMs > result.durationMs
    ) {
      warnings.push('An invalid ASR interval was omitted');
      complete = false;
      continue;
    }
    stage.primitives.push({
      id: crypto.randomUUID(),
      kind: 'text',
      role: 'asr',
      text: s.text,
      speaker: s.speaker,
      locator: { kind: 'media', timeline: 'container', startMs, endMs },
    });
  }
  stage.coverage = { complete, durationMs: result.durationMs, warnings };
  normalizeTranscription(stage);
  return result;
}
