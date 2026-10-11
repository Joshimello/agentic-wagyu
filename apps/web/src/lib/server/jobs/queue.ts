import { PgBoss } from 'pg-boss';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { outbox, chroniclerOutbox, pushBatches, runs } from '../db/schema';
import { stableId } from '../contracts/memory';
import { config } from '../config';
export const queueName = 'interpret';
export const chroniclerQueue = 'chronicle';
export async function startQueue() {
  const boss = new PgBoss(config.databaseUrl);
  boss.on('error', () =>
    console.error('Queue connection error; pending jobs remain durable'),
  );
  await boss.start();
  await boss.createQueue(queueName, {
    retryLimit: 3,
    retryDelay: 5,
    expireInSeconds: 7200,
  });
  await boss.updateQueue(queueName, {
    retryLimit: 3,
    retryDelay: 5,
    expireInSeconds: 7200,
  });
  await boss.createQueue(chroniclerQueue, {
    retryLimit: 3,
    retryDelay: 5,
    expireInSeconds: 7200,
  });
  await boss.updateQueue(chroniclerQueue, {
    retryLimit: 3,
    retryDelay: 5,
    expireInSeconds: 7200,
  });
  return boss;
}
export async function dispatchPending(boss: PgBoss) {
  const pending = await db
    .select()
    .from(outbox)
    .innerJoin(runs, eq(outbox.id, runs.id))
    .where(and(isNull(outbox.dispatchedAt), eq(runs.state, 'queued')))
    .limit(50);
  for (const row of pending) {
    const item = row.job_outbox;
    await boss.send(queueName, { runId: item.id }, { id: item.id });
    await db
      .update(outbox)
      .set({ dispatchedAt: new Date() })
      .where(eq(outbox.id, item.id));
  }
}

export async function dispatchPushes(boss: PgBoss) {
  const pending = await db
    .select()
    .from(chroniclerOutbox)
    .innerJoin(pushBatches, eq(chroniclerOutbox.id, pushBatches.id))
    .where(
      and(
        isNull(chroniclerOutbox.dispatchedAt),
        eq(pushBatches.state, 'queued'),
      ),
    )
    .limit(50);
  for (const row of pending) {
    const item = row.chronicler_outbox,
      batch = row.push_batches;
    await boss.send(
      chroniclerQueue,
      { pushId: item.id, generation: batch.generation },
      { id: stableId(item.id, 'queue', String(batch.generation)) },
    );
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(pushBatches)
        .where(eq(pushBatches.id, item.id))
        .for('update');
      if (current?.generation !== batch.generation) return;
      await tx
        .update(chroniclerOutbox)
        .set({ dispatchedAt: new Date() })
        .where(eq(chroniclerOutbox.id, item.id));
    });
  }
}
