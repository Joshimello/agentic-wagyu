import type { Stage } from '../contracts';
import type { Citation } from '../contracts/research';
import type { segmentContent } from '../agents/chronicler/organization/source';
export type EvidencePart = { primitiveId: string; first: number; last: number };
type Text = ReturnType<typeof segmentContent>['texts'][number];
export function spanText(stage: Stage, parts: EvidencePart[]) {
  return parts
    .map((part) => {
      const p = stage.primitives.find((p) => p.id === part.primitiveId);
      if (
        !p ||
        p.kind !== 'text' ||
        !Number.isSafeInteger(part.first) ||
        !Number.isSafeInteger(part.last) ||
        part.first < 0 ||
        part.last < part.first ||
        part.last > p.text.length
      )
        throw new Error('Invalid evidence span');
      const text = p.text.slice(part.first, part.last);
      if (parts.length === 1) return text;
      if (p.role !== 'asr' || p.locator.kind !== 'media')
        throw new Error('Only consecutive transcript turns can share a span');
      const seconds = Math.floor(p.locator.startMs / 1000),
        stamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      return `[${stamp} · ${p.speaker ?? 'Unidentified speaker'}] ${text}`;
    })
    .join('\n');
}
export function readableTextChunks(stage: Stage, texts: Text[]) {
  const chunks: {
    primitiveId: string;
    text: string;
    speaker: string | null;
    locator: Citation['locator'];
    first: number;
    last: number;
    parts: EvidencePart[];
  }[] = [];
  const turnIndex = new Map(
    stage.primitives
      .filter((p) => p.kind === 'text' && p.role === 'asr')
      .map((p, i) => [p.id, i]),
  );
  let group: Text[] = [];
  const flush = () => {
    if (!group.length) return;
    const first = group[0],
      last = group.at(-1)!,
      parts = group.map((t) => ({
        primitiveId: t.primitiveId,
        first: t.first,
        last: t.last,
      }));
    chunks.push({
      ...first,
      parts,
      last: last.last,
      text: spanText(stage, parts),
      speaker: group.length === 1 ? first.speaker : null,
      locator:
        first.locator.kind === 'media' && last.locator.kind === 'media'
          ? { ...first.locator, endMs: last.locator.endMs }
          : first.locator,
    });
    group = [];
  };
  for (const text of texts)
    for (let i = 0; i < text.text.length; i += 2000) {
      const part = {
        ...text,
        text: text.text.slice(i, i + 2000),
        first: text.first + i,
        last: Math.min(text.last, text.first + i + 2000),
      };
      const asr = part.role === 'asr' && part.locator.kind === 'media';
      if (
        !asr ||
        (group.length &&
          asr &&
          turnIndex.get(part.primitiveId)! !==
            turnIndex.get(group.at(-1)!.primitiveId)! + 1) ||
        group.length >= 60 ||
        group.at(-1)?.primitiveId === part.primitiveId ||
        group.some((t) => t.role !== 'asr' || t.locator.kind !== 'media') ||
        group.reduce((n, t) => n + t.text.length + 40, 0) +
          part.text.length +
          40 >
          2400
      )
        flush();
      group.push(part);
      if (!asr) flush();
    }
  flush();
  return chunks;
}
export function spanPartsFromRange(
  stage: Stage,
  anchorId: string,
  throughId: string,
  first: number,
  last: number,
) {
  const turns = stage.primitives.filter(
    (p) => p.kind === 'text' && p.role === 'asr',
  );
  const a = turns.findIndex((p) => p.id === anchorId),
    b = turns.findIndex((p) => p.id === throughId);
  if (a < 0 || b < a || b - a >= 60)
    throw new Error('Invalid transcript span range');
  const parts = turns
    .slice(a, b + 1)
    .map((p, i) => ({
      primitiveId: p.id,
      first: i === 0 ? first : 0,
      last: i === b - a ? last : p.kind === 'text' ? p.text.length : 0,
    }));
  spanText(stage, parts);
  return parts;
}
