import { z } from 'zod';
import { id } from './index';

export const translationPromptVersion = 'transcript-translation-1';
export const translationLanguage = z.enum(['en', 'zh-TW']);
export const translationInput = z
  .object({ revisionId: id, language: translationLanguage })
  .strict();
export type TranslationLanguage = z.infer<typeof translationLanguage>;
export type TranslatedPrimitive = { primitiveId: string; text: string };
export type TranslationPart = {
  ref: string;
  primitiveId: string;
  text: string;
};
export type TranslatedPart = { ref: string; text: string };
export type TranslationStatus = {
  id: string | null;
  state: 'not_requested' | 'queued' | 'processing' | 'ready' | 'failed';
  revisionId: string;
  language: TranslationLanguage;
  completedSegments: number;
  totalSegments: number;
  translations: TranslatedPrimitive[];
  error: string | null;
  model: string | null;
  promptVersion: string | null;
  updatedAt: string | null;
};

export const translationResponse = z
  .object({
    translations: z.array(
      z.object({ ref: z.string().min(1), text: z.string() }).strict(),
    ),
  })
  .strict();

/** Reject missing, repeated, fabricated, or empty translations before caching. */
export function validateTranslationBatch(
  parts: readonly TranslationPart[],
  value: unknown,
): TranslatedPart[] {
  const result = translationResponse.parse(value).translations;
  const expected = new Map(parts.map((part) => [part.ref, part]));
  const actual = new Set<string>();
  for (const translation of result) {
    const source = expected.get(translation.ref);
    if (!source || actual.has(translation.ref))
      throw new Error('Translation returned an unknown or repeated segment');
    if (source.text.trim() && !translation.text.trim())
      throw new Error('Translation omitted the text of a segment');
    actual.add(translation.ref);
  }
  if (actual.size !== expected.size)
    throw new Error('Translation did not return every requested segment');
  const byRef = new Map(result.map((part) => [part.ref, part]));
  return parts.map((part) => byRef.get(part.ref)!);
}
