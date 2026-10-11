import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, sqlClient } from '../../db/client';
import { assets, researchRuns } from '../../db/schema';
import { assetPath } from '../../storage';
import { getResearch, loadResearchCorpus } from '../../services/research';
import { researchPromptVersion } from '../../contracts/research';
import { answerQuestion, type ResearchModelOptions } from './model';
import { withOperation } from '../../jobs/operation';
export async function readResearchImage(assetId: string) {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mime))
    throw new Error('Readable image asset unavailable');
  const file = Bun.file(assetPath(asset.storageKey));
  if (file.size > 12000000)
    throw new Error('Image exceeds inspection byte limit');
  return {
    url: `data:${asset.mime};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`,
    bytes: file.size,
  };
}
/** Session lock makes duplicate deliveries harmless; a worker crash releases it for queue retry. */
export async function research(id: string, options: ResearchModelOptions = {}) {
  const session = await sqlClient.reserve();
  let acquired = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Research time budget exceeded')),
    12 * 60 * 1000,
  );
  try {
    const [lock] =
      await session`select pg_try_advisory_lock(hashtextextended(${id},736504)) as acquired`;
    if (!lock.acquired)
      throw new Error('Research is already leased; retry delivery');
    acquired = true;
    const run = await getResearch(id);
    if (['completed', 'canceled'].includes(run.state)) return run;
    const [claimed] = await db
      .update(researchRuns)
      .set({
        state: 'processing',
        attempts: sql`${researchRuns.attempts}+1`,
        error: null,
        progress: 'Loading pinned memory',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(researchRuns.id, id),
          inArray(researchRuns.state, ['queued', 'processing', 'failed']),
        ),
      )
      .returning();
    if (!claimed) return;
    const currentAttempt = () =>
      and(
        eq(researchRuns.id, id),
        eq(researchRuns.state, 'processing'),
        eq(researchRuns.attempts, claimed.attempts),
      );
    timer = setInterval(() => {
      void getResearch(id)
        .then((current) => {
          if (
            current.state !== 'processing' ||
            current.attempts !== claimed.attempts
          )
            controller.abort(new Error('Research canceled'));
        })
        .catch(() => controller.abort(new Error('Research state unavailable')));
    }, 500);
    try {
      const corpus = await loadResearchCorpus(run.scope);
      const result = await withOperation(
        { kind: 'research', id, signal: controller.signal },
        () =>
          answerQuestion(run.input.question, corpus, {
            ...options,
            signal: options.signal
              ? AbortSignal.any([controller.signal, options.signal])
              : controller.signal,
            readImage: options.readImage ?? readResearchImage,
            progress: async (progress) => {
              await db
                .update(researchRuns)
                .set({ progress, updatedAt: new Date() })
                .where(currentAttempt());
              await options.progress?.(progress);
            },
          }),
      );
      controller.signal.throwIfAborted();
      const [completed] = await db
        .update(researchRuns)
        .set({
          ...result,
          state: 'completed',
          progress: 'Answer ready',
          promptVersion: researchPromptVersion,
          updatedAt: new Date(),
        })
        .where(currentAttempt())
        .returning();
      return completed;
    } catch (error) {
      const details = error as {
        researchTrace?: import('../../contracts/research').ResearchTrace[];
        researchUsage?: {
          inputTokens: number;
          outputTokens: number;
          calls: number;
          elapsedMs: number;
        };
        researchModel?: string;
      };
      await db
        .update(researchRuns)
        .set({
          state: 'failed',
          trace: details?.researchTrace ?? [],
          usage: details?.researchUsage ?? null,
          model: details?.researchModel ?? null,
          promptVersion: researchPromptVersion,
          error:
            'Research could not finish a valid cited answer. Retry preserves the original memory snapshot.',
          progress: 'No answer published',
          updatedAt: new Date(),
        })
        .where(currentAttempt());
      console.error('Research failed', {
        errorType: error instanceof Error ? error.name : 'Unknown',
      });
      throw error;
    }
  } finally {
    if (timer) clearInterval(timer);
    clearTimeout(timeout);
    if (acquired)
      await session`select pg_advisory_unlock(hashtextextended(${id},736504))`;
    session.release();
  }
}
