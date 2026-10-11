import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  revisions,
  translationJobs,
  translationOutbox,
  uploads,
} from '../db/schema';
import { id } from '../contracts';
import {
  translationInput,
  translationPromptVersion,
  type TranslationStatus,
} from '../contracts/translations';
import {
  translationFingerprint,
  translationParts,
} from '../agents/translation/batches';

export class TranslationRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function status(row: typeof translationJobs.$inferSelect): TranslationStatus {
  return {
    id: row.id,
    state: row.state,
    revisionId: row.revisionId,
    language: row.language,
    completedSegments: row.completedSegments,
    totalSegments: row.totalSegments,
    translations: row.translations,
    error: row.error,
    model: row.model,
    promptVersion: row.promptVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getTranslation(
  uploadId: string,
  value: unknown,
): Promise<TranslationStatus> {
  id.parse(uploadId);
  const input = translationInput.parse(value);
  const [revision] = await db
    .select()
    .from(revisions)
    .where(
      and(eq(revisions.id, input.revisionId), eq(revisions.uploadId, uploadId)),
    );
  if (!revision)
    throw new TranslationRequestError(
      'Revision not found for this upload',
      404,
    );
  const [cached] = await db
    .select()
    .from(translationJobs)
    .where(
      and(
        eq(translationJobs.revisionId, input.revisionId),
        eq(translationJobs.language, input.language),
        eq(translationJobs.promptVersion, translationPromptVersion),
      ),
    );
  if (cached) return status(cached);
  return {
    id: null,
    state: 'not_requested',
    ...input,
    completedSegments: 0,
    totalSegments: revision.manifest.primitives.filter((p) => p.kind === 'text')
      .length,
    translations: [],
    error: null,
    model: null,
    promptVersion: null,
    updatedAt: null,
  };
}

export async function requestTranslation(
  uploadId: string,
  value: unknown,
): Promise<TranslationStatus> {
  id.parse(uploadId);
  const input = translationInput.parse(value);
  return db.transaction(async (tx) => {
    // Serialize repeated clicks, retry requests, and corrections for this upload.
    const [upload] = await tx
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .for('update');
    if (!upload) throw new TranslationRequestError('Upload not found', 404);
    const [revision] = await tx
      .select()
      .from(revisions)
      .where(
        and(
          eq(revisions.id, input.revisionId),
          eq(revisions.uploadId, uploadId),
        ),
      );
    if (!revision)
      throw new TranslationRequestError(
        'Revision not found for this upload',
        404,
      );
    const [cached] = await tx
      .select()
      .from(translationJobs)
      .where(
        and(
          eq(translationJobs.revisionId, input.revisionId),
          eq(translationJobs.language, input.language),
          eq(translationJobs.promptVersion, translationPromptVersion),
        ),
      )
      .for('update');
    if (cached && cached.state !== 'failed') return status(cached);
    if (cached) {
      const [retried] = await tx
        .update(translationJobs)
        .set({
          state: 'queued',
          error: null,
          generation: sql`${translationJobs.generation}+1`,
          updatedAt: new Date(),
        })
        .where(eq(translationJobs.id, cached.id))
        .returning();
      await tx
        .insert(translationOutbox)
        .values({ id: cached.id })
        .onConflictDoUpdate({
          target: translationOutbox.id,
          set: { dispatchedAt: null },
        });
      return status(retried);
    }
    const parts = translationParts(revision.manifest);
    const [created] = await tx
      .insert(translationJobs)
      .values({
        id: crypto.randomUUID(),
        ...input,
        promptVersion: translationPromptVersion,
        fingerprint: translationFingerprint(
          input.revisionId,
          input.language,
          parts,
        ),
        totalSegments: new Set(parts.map((part) => part.primitiveId)).size,
        state: parts.length ? 'queued' : 'ready',
      })
      .returning();
    if (parts.length)
      await tx.insert(translationOutbox).values({ id: created.id });
    return status(created);
  });
}
