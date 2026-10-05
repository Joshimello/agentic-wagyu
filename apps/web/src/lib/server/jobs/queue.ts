import { PgBoss } from 'pg-boss';
import { eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { outbox } from '../db/schema';
import { config } from '../config';
export const queueName = 'interpret';
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
  return boss;
}
export async function dispatchPending(boss: PgBoss) {
  const pending = await db
    .select()
    .from(outbox)
    .where(isNull(outbox.dispatchedAt))
    .limit(50);
  for (const item of pending) {
    await boss.send(queueName, { runId: item.id }, { id: item.id });
    await db
      .update(outbox)
      .set({ dispatchedAt: new Date() })
      .where(eq(outbox.id, item.id));
  }
}
