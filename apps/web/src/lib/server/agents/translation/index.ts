import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, sqlClient } from '../../db/client';
import { revisions, translationJobs, uploads } from '../../db/schema';
import { watchJob } from '../../jobs/control';
import { llmClient } from '../../llm/client';
import {
  translationPromptVersion,
  validateTranslationBatch,
  type TranslationLanguage,
  type TranslationPart,
  type TranslatedPart,
} from '../../contracts/translations';
import {
  completedTranslations,
  translationBatches,
  translationFingerprint,
  translationParts,
} from './batches';
import { translateBatch } from './model';

type Options = {
  llm?: ReturnType<typeof llmClient>;
  signal?: AbortSignal;
  retrying?: boolean;
  generation?: number;
  translate?: (
    parts: readonly TranslationPart[],
    language: TranslationLanguage,
  ) => Promise<TranslatedPart[]>;
};

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/configure.*credentials/i.test(message))
    return 'Translation service is not configured. Check the translation worker credentials.';
  const validationErrors = new Set([
    'Translation returned an unknown or repeated segment',
    'Translation omitted the text of a segment',
    'Translation did not return every requested segment',
    'Translation exceeded the model output limit',
    'Translation source revision is unavailable',
    'Translation prompt changed; request a new translation',
    'Translation source revision does not match its checkpoint',
    'Translation checkpoint contains an unknown or repeated segment',
    'Translation did not cover every source segment',
    'The response did not match the JSON schema. Return every supplied ref exactly once with only ref and text fields.',
  ]);
  if (validationErrors.has(message)) return message;
  const status =
    typeof error === 'object' && error && 'status' in error
      ? error.status
      : undefined;
  if (status === 401 || status === 403)
    return 'Translation service authentication failed. Check the translation worker configuration.';
  if (status === 429)
    return 'Translation service is busy. Saved progress is retained; retry shortly.';
  return 'Translation could not finish. Saved progress is retained; try again.';
}

export async function translateRevision(
  translationId: string,
  options: Options = {},
) {
  const connection = await sqlClient.reserve();
  let locked = false;
  let control: ReturnType<typeof watchJob> | undefined;
  try {
    // A session lock prevents duplicate deliveries from racing checkpoint writes.
    const [lock] =
      await connection`select pg_try_advisory_lock(hashtextextended(${translationId}, 72417)) as locked`;
    if (!lock.locked) throw new Error('Translation is already processing');
    locked = true;
    const [job] = await db
      .select()
      .from(translationJobs)
      .where(eq(translationJobs.id, translationId));
    if (
      !job ||
      ['ready', 'canceled'].includes(job.state) ||
      (options.generation !== undefined &&
        options.generation !== job.generation)
    )
      return;
    const guard = and(
      eq(translationJobs.id, translationId),
      eq(translationJobs.generation, job.generation),
      eq(translationJobs.state, 'processing'),
    );
    control = watchJob(async () => {
      const [current] = await db
        .select({
          state: translationJobs.state,
          generation: translationJobs.generation,
          deletedAt: uploads.deletedAt,
        })
        .from(translationJobs)
        .innerJoin(revisions, eq(translationJobs.revisionId, revisions.id))
        .innerJoin(uploads, eq(revisions.uploadId, uploads.id))
        .where(eq(translationJobs.id, translationId));
      return (
        !!current &&
        current.generation === job.generation &&
        ['queued', 'processing', 'failed'].includes(current.state) &&
        !current.deletedAt
      );
    }, options.signal);
    const claimed = await db
      .update(translationJobs)
      .set({
        state: 'processing',
        attempts: sql`${translationJobs.attempts}+1`,
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(translationJobs.id, translationId),
          eq(translationJobs.generation, job.generation),
          inArray(translationJobs.state, ['queued', 'failed', 'processing']),
        ),
      )
      .returning();
    if (!claimed.length) return;
    try {
      await control.assertActive();
      const [revision] = await db
        .select()
        .from(revisions)
        .where(eq(revisions.id, job.revisionId));
      if (!revision)
        throw new Error('Translation source revision is unavailable');
      if (job.promptVersion !== translationPromptVersion)
        throw new Error(
          'Translation prompt changed; request a new translation',
        );
      const parts = translationParts(revision.manifest);
      if (
        job.fingerprint !==
        translationFingerprint(job.revisionId, job.language, parts)
      )
        throw new Error(
          'Translation source revision does not match its checkpoint',
        );
      const partByRef = new Map(parts.map((part) => [part.ref, part]));
      const checkpoint: TranslatedPart[] = [];
      for (const part of job.checkpoint) {
        const source = partByRef.get(part.ref);
        if (!source || checkpoint.some((saved) => saved.ref === part.ref))
          throw new Error(
            'Translation checkpoint contains an unknown or repeated segment',
          );
        checkpoint.push(
          ...validateTranslationBatch([source], { translations: [part] }),
        );
      }
      const saved = new Set(checkpoint.map((part) => part.ref));
      const empty = parts.filter(
        (part) => !saved.has(part.ref) && !part.text.trim(),
      );
      checkpoint.push(...empty.map((part) => ({ ref: part.ref, text: '' })));
      empty.forEach((part) => saved.add(part.ref));
      const pending = parts.filter((part) => !saved.has(part.ref));
      const llm =
        !pending.length || options.translate
          ? options.llm
          : (options.llm ?? llmClient());
      const model =
        job.model ??
        llm?.model ??
        (options.translate ? 'injected-test-translator' : null);
      await db
        .update(translationJobs)
        .set({ model, updatedAt: new Date() })
        .where(guard);
      for (const batch of translationBatches(pending)) {
        await control.assertActive();
        const translated = options.translate
          ? await options.translate(batch, job.language)
          : await translateBatch(batch, job.language, {
              llm,
              model: model ?? undefined,
              signal: control.signal,
            });
        await control.assertActive();
        checkpoint.push(
          ...validateTranslationBatch(batch, { translations: translated }),
        );
        const translations = completedTranslations(parts, checkpoint);
        await db
          .update(translationJobs)
          .set({
            checkpoint,
            translations,
            completedSegments: translations.length,
            updatedAt: new Date(),
          })
          .where(guard);
      }
      const translations = completedTranslations(parts, checkpoint);
      if (translations.length !== job.totalSegments)
        throw new Error('Translation did not cover every source segment');
      await db
        .update(translationJobs)
        .set({
          state: 'ready',
          checkpoint,
          translations,
          completedSegments: translations.length,
          error: null,
          updatedAt: new Date(),
        })
        .where(guard);
    } catch (error) {
      const [current] = await db
        .select()
        .from(translationJobs)
        .where(eq(translationJobs.id, translationId));
      if (
        current?.state === 'canceled' ||
        current?.generation !== job.generation
      )
        return;
      await db
        .update(translationJobs)
        .set({
          state: options.retrying ? 'queued' : 'failed',
          error: publicError(error),
          updatedAt: new Date(),
        })
        .where(guard);
      const [latest] = await db
        .select()
        .from(translationJobs)
        .where(eq(translationJobs.id, translationId));
      if (latest?.state === 'canceled' || latest?.generation !== job.generation)
        return;
      throw error;
    }
  } finally {
    control?.stop();
    try {
      if (locked)
        await connection`select pg_advisory_unlock(hashtextextended(${translationId}, 72417))`;
    } finally {
      connection.release();
    }
  }
}
