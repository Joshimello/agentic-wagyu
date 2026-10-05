import { asrSchema } from './transcript';
export const sectionMs = 180000;
export function audioSections(durationMs: number) {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
    throw new Error('Invalid audio duration');
  return Array.from(
    { length: Math.ceil(durationMs / sectionMs) },
    (_, index) => ({
      index,
      startMs: index * sectionMs,
      durationMs: Math.min(sectionMs, durationMs - index * sectionMs),
    }),
  );
}
export function joinAudioSections(durationMs: number, values: unknown[]) {
  const sections = audioSections(durationMs);
  if (values.length !== sections.length)
    throw new Error('Missing audio sections');
  const parts = values.map((value, index) => {
    const part = asrSchema.parse(value);
    if (part.durationMs !== sections[index].durationMs)
      throw new Error('Audio section duration mismatch');
    const valid = part.segments.filter(
      (s) =>
        s.end >= s.start &&
        s.start * 1000 < part.durationMs &&
        s.end * 1000 <= part.durationMs,
    );
    if (valid.length !== part.segments.length) {
      part.segments = valid;
      part.truncated = true;
      part.warnings = [
        ...(part.warnings ?? []),
        'Invalid local ASR intervals were omitted; section speech may be incomplete.',
      ];
    }
    return part;
  });
  if (
    parts.some(
      (p) => p.model !== parts[0].model || p.revision !== parts[0].revision,
    )
  )
    throw new Error('Audio sections have different model revisions');
  return {
    durationMs,
    model: parts[0].model,
    revision: parts[0].revision,
    truncated: parts.some((p) => p.truncated),
    segments: parts.flatMap((part, index) =>
      part.segments.map((segment) => ({
        ...segment,
        start: segment.start + sections[index].startMs / 1000,
        end: segment.end + sections[index].startMs / 1000,
        speaker:
          parts.length > 1
            ? `Part ${index + 1} · ${segment.speaker}`
            : segment.speaker,
      })),
    ),
    warnings: [
      ...parts.flatMap((p, i) =>
        (p.warnings ?? []).map((w) => `Part ${i + 1}: ${w}`),
      ),
      ...(parts.length > 1
        ? [
            'Speaker labels are local to each three-minute audio section; matching identities across sections is unverified. Section boundaries may split spoken phrases.',
            ...parts.flatMap((p, i) =>
              new Set(p.segments.map((s) => s.speaker)).size === 1
                ? [
                    `Part ${i + 1}: only one anonymous speaker was detected; merged voices remain possible.`,
                  ]
                : [],
            ),
          ]
        : []),
    ],
  };
}
