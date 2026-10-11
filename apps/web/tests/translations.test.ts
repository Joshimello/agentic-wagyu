import { expect, test } from 'bun:test';
import type { Stage } from '../src/lib/server/contracts';
import {
  translationInput,
  validateTranslationBatch,
} from '../src/lib/server/contracts/translations';
import {
  completedTranslations,
  translationBatches,
  translationFingerprint,
  translationParts,
} from '../src/lib/server/agents/translation/batches';
import { translateBatch } from '../src/lib/server/agents/translation/model';
import type { llmClient } from '../src/lib/server/llm/client';

function source(texts: string[]): Stage {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    rawAssetId: crypto.randomUUID(),
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      label: 'Translation regression',
      sourceTime: null,
      sourceTimeOrigin: 'unknown',
    },
    primitives: texts.map((text, i) => ({
      id: crypto.randomUUID(),
      kind: 'text',
      role: 'asr',
      text,
      speaker: 'S01',
      locator: {
        kind: 'media',
        timeline: 'container',
        startMs: i * 1000,
        endMs: (i + 1) * 1000,
      },
    })),
    annotations: [],
    coverage: { complete: true, durationMs: texts.length * 1000, warnings: [] },
    provenance: {
      adapter: 'video',
      model: 'MOSS',
      modelRevision: 'pinned',
      promptVersion: null,
    },
  };
}

test('translation contracts pin revision and permit only English or Taiwan Traditional Chinese', () => {
  expect(
    translationInput.parse({
      revisionId: crypto.randomUUID(),
      language: 'zh-TW',
    }).language,
  ).toBe('zh-TW');
  expect(() =>
    translationInput.parse({
      revisionId: crypto.randomUUID(),
      language: 'zh-CN',
    }),
  ).toThrow();
  expect(() =>
    translationInput.parse({ revisionId: 'current', language: 'en' }),
  ).toThrow();
});

test('translation mapping rejects omissions, extra refs, repetitions and empty results', () => {
  const parts = translationParts(source(['first', 'second']));
  const valid = parts.map((part) => ({ ref: part.ref, text: 'translated' }));
  expect(
    validateTranslationBatch(parts, { translations: valid.toReversed() }),
  ).toEqual(valid);
  for (const invalid of [
    valid.slice(1),
    [...valid, valid[0]],
    [{ ...valid[0], ref: 'fabricated' }, valid[1]],
    [{ ...valid[0], text: '' }, valid[1]],
  ])
    expect(() =>
      validateTranslationBatch(parts, { translations: invalid }),
    ).toThrow();
});

test('large primitives are bounded, exactly preserved in requests, and appear only when every fragment is complete', () => {
  const stage = source(['A sentence. '.repeat(900), '', 'Last segment']);
  const original = JSON.stringify(stage);
  const parts = translationParts(stage);
  expect(
    parts
      .filter((part) => part.primitiveId === stage.primitives[0].id)
      .map((part) => part.text)
      .join(''),
  ).toBe((stage.primitives[0] as { text: string }).text);
  expect(parts.every((part) => part.text.length <= 3000)).toBe(true);
  expect(
    translationBatches(parts).every(
      (batch) =>
        batch.length <= 16 &&
        batch.reduce((n, part) => n + part.text.length, 0) <= 6000,
    ),
  ).toBe(true);
  const checkpoint = parts.map((part) => ({ ref: part.ref, text: part.text }));
  expect(
    completedTranslations(parts, checkpoint.slice(1)).some(
      (p) => p.primitiveId === stage.primitives[0].id,
    ),
  ).toBe(false);
  expect(
    completedTranslations(parts, checkpoint).map((p) => p.primitiveId),
  ).toEqual(stage.primitives.map((p) => p.id));
  expect(JSON.stringify(stage)).toBe(original);
});

test('cache fingerprint separates revision, language, and corrected evidence', () => {
  const stage = source(['Original']);
  const fingerprint = translationFingerprint(
    stage.id,
    'en',
    translationParts(stage),
  );
  expect(
    translationFingerprint(crypto.randomUUID(), 'en', translationParts(stage)),
  ).not.toBe(fingerprint);
  expect(
    translationFingerprint(stage.id, 'zh-TW', translationParts(stage)),
  ).not.toBe(fingerprint);
  (stage.primitives[0] as { text: string }).text = 'Corrected';
  expect(
    translationFingerprint(stage.id, 'en', translationParts(stage)),
  ).not.toBe(fingerprint);
});

test('model validates complete JSON, retries a malformed mapping and normalizes Traditional script', async () => {
  const parts = translationParts(source(['Pipeline']));
  const requests: Record<string, unknown>[] = [];
  const llm = {
    model: 'qwen-regression',
    client: {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requests.push(input);
            return {
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    content: JSON.stringify({
                      translations:
                        requests.length === 1
                          ? []
                          : [
                              {
                                ref: parts[0].ref,
                                text: '\u8fd9\u662f\u6d4b\u8bd5',
                              },
                            ],
                    }),
                  },
                },
              ],
            };
          },
        },
      },
    },
  } as unknown as ReturnType<typeof llmClient>;
  const result = await translateBatch(parts, 'zh-TW', { llm });
  expect(result[0].text).toBe('\u9019\u662f\u6e2c\u8a66');
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    model: 'qwen-regression',
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  });
  expect(JSON.stringify(requests[1])).toContain('every requested segment');
});
