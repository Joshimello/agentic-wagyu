import { eq, sql, and, inArray } from 'drizzle-orm';
import { currentOperation, leasedOperation } from '../../jobs/operation';
import { db } from '../../db/client';
import { pushBatches, revisions } from '../../db/schema';
import { validateStage } from '../../contracts';
import { memorySnapshot } from '../../services/memory';
import { buildMemoryPlan } from './model';
import { buildOrganizationPlan } from './organization/model';
import { publishMemory, StaleMemory } from './publication';
export async function chronicle(
  pushId: string,
  options: { buildPlan?: typeof buildMemoryPlan } = {},
) {
  return leasedOperation('chronicle', pushId, () =>
    chronicleLeased(pushId, options),
  );
}
async function chronicleLeased(
  pushId: string,
  options: { buildPlan?: typeof buildMemoryPlan },
) {
  let [batch] = await db
    .select()
    .from(pushBatches)
    .where(eq(pushBatches.id, pushId));
  if (!batch || ['committed', 'canceled'].includes(batch.state)) return batch;
  const [claimed] = await db
    .update(pushBatches)
    .set({
      state: 'processing',
      attempts: sql`${pushBatches.attempts}+1`,
      progress: 'Loading pinned evidence',
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pushBatches.id, pushId),
        inArray(pushBatches.state, ['queued', 'processing', 'failed']),
      ),
    )
    .returning();
  if (!claimed) return;
  const currentAttempt = () =>
    and(
      eq(pushBatches.id, pushId),
      eq(pushBatches.state, 'processing'),
      eq(pushBatches.attempts, claimed.attempts),
    );
  const progress = async (text: string) => {
    currentOperation()?.signal?.throwIfAborted();
    await db
      .update(pushBatches)
      .set({ progress: text, updatedAt: new Date() })
      .where(currentAttempt());
  };
  try {
    const stages = [];
    for (const item of batch.input.items) {
      const [r] = await db
        .select()
        .from(revisions)
        .where(eq(revisions.id, item.revisionId));
      if (!r || r.uploadId !== item.uploadId)
        throw new Error('Pinned evidence is missing');
      stages.push(validateStage(r.manifest));
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await memorySnapshot();
      const plan =
        batch.plan?.baseVersion === snapshot.version
          ? batch.plan
          : await (
              options.buildPlan ??
              (batch.input.workflow === 'summary'
                ? buildOrganizationPlan
                : buildMemoryPlan)
            )(pushId, batch.input, stages, snapshot, { progress });
      await db
        .update(pushBatches)
        .set({ baseVersion: snapshot.version, plan, updatedAt: new Date() })
        .where(currentAttempt());
      await progress('Validating and publishing memory');
      try {
        currentOperation()?.signal?.throwIfAborted();
        return await publishMemory(pushId, plan, claimed.attempts);
      } catch (error) {
        if (!(error instanceof StaleMemory)) throw error;
        batch = { ...batch, plan: null };
        await progress('Memory changed; refreshing reconciliation');
      }
    }
    throw new Error('Memory changed repeatedly; retry this pinned push');
  } catch (error) {
    const [current] = await db
      .select()
      .from(pushBatches)
      .where(eq(pushBatches.id, pushId));
    if (current?.state === 'canceled') return current;
    console.error('Chronicler push failed', {
      errorType: error instanceof Error ? error.name : 'Unknown',
    });
    await db
      .update(pushBatches)
      .set({
        state: 'failed',
        error:
          'Memory processing failed. Source selection is preserved; retry this push.',
        progress: 'No memory changes were published',
        updatedAt: new Date(),
      })
      .where(currentAttempt());
    throw error;
  }
}
