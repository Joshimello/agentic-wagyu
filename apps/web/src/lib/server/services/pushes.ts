import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  pushBatches,
  pushItems,
  chroniclerOutbox,
  revisions,
  memoryCommits,
  memoryProjects,
  stagingSelections,
} from '../db/schema';
import { validatePush, validateStage } from '../contracts';
import { pushInput, type PushInput } from '../contracts/memory';
export async function createPush(value: unknown) {
  const input = pushInput.parse(value);
  const canonical = {
    items: [...input.items].sort((a, b) =>
      a.uploadId.localeCompare(b.uploadId),
    ),
    projectScope: input.projectScope,
    ...(input.workflow === 'summary' ? { workflow: input.workflow } : {}),
  };
  const fingerprint = new Bun.CryptoHasher('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(736501)`);
    const [existing] = await tx
      .select()
      .from(pushBatches)
      .where(eq(pushBatches.idempotencyKey, input.idempotencyKey));
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error(
          'Idempotency key already belongs to a different selection',
        );
      return existing;
    }
    const batches = await tx
      .select()
      .from(pushBatches)
      .where(eq(pushBatches.fingerprint, fingerprint));
    const same = batches.find((b) =>
      ['queued', 'processing', 'committed'].includes(b.state),
    );
    if (same) return same;
    const selected = [];
    for (const item of input.items) {
      const [r] = await tx
        .select()
        .from(revisions)
        .where(eq(revisions.id, item.revisionId));
      if (!r || r.uploadId !== item.uploadId)
        throw new Error('Revision does not belong to selected source');
      selected.push(validateStage(r.manifest));
    }
    const [latest] = await tx
      .select({
        version: sql<number>`coalesce(max(${memoryCommits.version}),0)::int`,
      })
      .from(memoryCommits);
    const id = crypto.randomUUID();
    validatePush(
      {
        id,
        idempotencyKey: input.idempotencyKey,
        createdAt: new Date().toISOString(),
        expectedMemoryVersion: latest.version,
        items: input.items,
      },
      selected,
    );
    if (input.projectScope.mode === 'existing') {
      const [project] = await tx
        .select()
        .from(memoryProjects)
        .where(eq(memoryProjects.id, input.projectScope.projectId));
      if (!project) throw new Error('Selected project does not exist');
    }
    const [batch] = await tx
      .insert(pushBatches)
      .values({
        id,
        input,
        fingerprint,
        idempotencyKey: input.idempotencyKey,
        baseVersion: latest.version,
      })
      .returning();
    for (const item of input.items)
      await tx
        .insert(pushItems)
        .values({ id: crypto.randomUUID(), pushId: id, ...item });
    await tx.insert(chroniclerOutbox).values({ id });
    return batch;
  });
}
export async function listPushes() {
  return db
    .select({
      id: pushBatches.id,
      state: pushBatches.state,
      progress: pushBatches.progress,
      error: pushBatches.error,
      commitVersion: pushBatches.commitVersion,
      outcomes: pushBatches.outcomes,
      createdAt: pushBatches.createdAt,
    })
    .from(pushBatches)
    .orderBy(sql`${pushBatches.createdAt} desc`)
    .limit(100);
}
export async function getPush(id: string) {
  const [batch] = await db
    .select()
    .from(pushBatches)
    .where(eq(pushBatches.id, id));
  if (!batch) throw new Error('Push not found');
  const { checkpoints, plan, ...result } = batch;
  return result;
}
export async function retryPush(id: string) {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(pushBatches)
      .where(eq(pushBatches.id, id))
      .for('update');
    if (!batch) throw new Error('Push not found');
    if (batch.state === 'committed') return batch;
    if (batch.state !== 'failed')
      throw new Error('Push must fail before retrying');
    await tx
      .update(pushBatches)
      .set({
        state: 'queued',
        error: null,
        progress: 'Waiting for Chronicler',
        updatedAt: new Date(),
      })
      .where(eq(pushBatches.id, id));
    await tx
      .update(chroniclerOutbox)
      .set({ dispatchedAt: null })
      .where(eq(chroniclerOutbox.id, id));
    return { ...batch, state: 'queued' };
  });
}
