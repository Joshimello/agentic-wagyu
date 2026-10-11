import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  pushBatches,
  pushItems,
  chroniclerOutbox,
  revisions,
  memoryCommits,
  memoryProjects,
  stagingSelections,
  memoryNodes,
  uploads,
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
    ...(input.organizationMode === 'scope'
      ? { organizationMode: 'scope' }
      : {}),
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
      const [upload] = await tx
        .select()
        .from(uploads)
        .where(eq(uploads.id, item.uploadId))
        .for('update');
      if (!upload || upload.deletedAt)
        throw new Error('Selected source was removed from staging');
      const [r] = await tx
        .select()
        .from(revisions)
        .where(eq(revisions.id, item.revisionId));
      if (!r || r.uploadId !== item.uploadId)
        throw new Error('Revision does not belong to selected source');
      selected.push(validateStage(r.manifest));
    }
    if (input.organizationMode === 'scope') {
      if (input.workflow !== 'summary')
        throw new Error('Scope organization requires summary workflow');
      for (const item of input.items) {
        const existing = await tx
          .select()
          .from(memoryNodes)
          .where(eq(memoryNodes.revisionId, item.revisionId));
        if (!existing.some((n) => n.kind === 'source'))
          throw new Error(
            'Organize the source before assigning unassigned segments',
          );
      }
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
      const [organizedProject] =
        !project && input.workflow === 'summary'
          ? await tx
              .select()
              .from(memoryNodes)
              .where(
                and(
                  eq(memoryNodes.id, input.projectScope.projectId),
                  eq(memoryNodes.kind, 'project'),
                ),
              )
          : [];
      if (!project && !organizedProject)
        throw new Error('Selected project does not exist');
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
      progressPercent: pushBatches.progressPercent,
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
    await tx.execute(sql`select pg_advisory_xact_lock(736501)`);
    const [batch] = await tx
      .select()
      .from(pushBatches)
      .where(eq(pushBatches.id, id))
      .for('update');
    if (!batch) throw new Error('Push not found');
    if (batch.state === 'committed') return batch;
    if (!['failed', 'canceled'].includes(batch.state))
      throw new Error('Push must stop before retrying');
    for (const item of batch.input.items) {
      const [upload] = await tx
        .select()
        .from(uploads)
        .where(eq(uploads.id, item.uploadId));
      if (!upload || upload.deletedAt)
        throw new Error('Selected source was removed from staging');
    }
    const [retried] = await tx
      .update(pushBatches)
      .set({
        state: 'queued',
        error: null,
        progress: 'Waiting for Chronicler',
        generation: sql`${pushBatches.generation}+1`,
        updatedAt: new Date(),
      })
      .where(eq(pushBatches.id, id))
      .returning();
    await tx
      .update(chroniclerOutbox)
      .set({ dispatchedAt: null })
      .where(eq(chroniclerOutbox.id, id));
    return retried;
  });
}

export async function cancelPush(pushId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(736501)`);
    const [batch] = await tx
      .select()
      .from(pushBatches)
      .where(eq(pushBatches.id, pushId))
      .for('update');
    if (!batch) throw new Error('Push not found');
    if (!['queued', 'processing'].includes(batch.state)) return;
    await tx
      .update(pushBatches)
      .set({
        state: 'canceled',
        error: null,
        generation: sql`${pushBatches.generation}+1`,
        progress: 'Canceled; completed work is saved',
        updatedAt: new Date(),
      })
      .where(eq(pushBatches.id, pushId));
    await tx
      .update(chroniclerOutbox)
      .set({ dispatchedAt: new Date() })
      .where(eq(chroniclerOutbox.id, pushId));
  });
  return getPush(pushId);
}
