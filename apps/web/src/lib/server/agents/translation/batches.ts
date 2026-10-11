import { createHash } from 'node:crypto';
import type { Stage } from '../../contracts';
import {
  translationPromptVersion,
  type TranslationLanguage,
  type TranslationPart,
  type TranslatedPart,
  type TranslatedPrimitive,
} from '../../contracts/translations';

const partCharacters = 3000;
const batchCharacters = 6000;
const batchSegments = 16;

/** Bound large document primitives as well as ordinary short speech segments. */
export function translationParts(stage: Stage): TranslationPart[] {
  const parts: TranslationPart[] = [];
  for (const primitive of stage.primitives) {
    if (primitive.kind !== 'text') continue;
    let remaining = primitive.text;
    let index = 0;
    do {
      let end = Math.min(partCharacters, remaining.length);
      if (end < remaining.length) {
        const boundary = Math.max(
          remaining.lastIndexOf('\n', end - 1),
          remaining.lastIndexOf('. ', end - 1),
          remaining.lastIndexOf('\u3002', end - 1),
          remaining.lastIndexOf(' ', end - 1),
        );
        if (boundary >= partCharacters / 2) end = boundary + 1;
        const previous = remaining.charCodeAt(end - 1);
        if (previous >= 0xd800 && previous <= 0xdbff) end--;
      }
      parts.push({
        ref: `${primitive.id}:${index++}`,
        primitiveId: primitive.id,
        text: remaining.slice(0, end),
      });
      remaining = remaining.slice(end);
    } while (remaining.length);
  }
  return parts;
}

export function translationBatches(parts: readonly TranslationPart[]) {
  const batches: TranslationPart[][] = [];
  let batch: TranslationPart[] = [],
    characters = 0;
  for (const part of parts) {
    if (
      batch.length &&
      (batch.length >= batchSegments ||
        characters + part.text.length > batchCharacters)
    ) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(part);
    characters += part.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function translationFingerprint(
  revisionId: string,
  language: TranslationLanguage,
  parts: readonly TranslationPart[],
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        revisionId,
        language,
        promptVersion: translationPromptVersion,
        parts,
      }),
    )
    .digest('hex');
}

export function completedTranslations(
  parts: readonly TranslationPart[],
  checkpoint: readonly TranslatedPart[],
): TranslatedPrimitive[] {
  const translated = new Map(checkpoint.map((part) => [part.ref, part.text]));
  const groups = new Map<string, TranslationPart[]>();
  for (const part of parts) {
    const group = groups.get(part.primitiveId) ?? [];
    group.push(part);
    groups.set(part.primitiveId, group);
  }
  return [...groups].flatMap(([primitiveId, group]) =>
    group.every((part) => translated.has(part.ref))
      ? [
          {
            primitiveId,
            text: group.map((part) => translated.get(part.ref)!).join('\n'),
          },
        ]
      : [],
  );
}
