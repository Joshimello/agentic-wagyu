import { PgBoss } from 'pg-boss';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import {
  outbox,
  chroniclerOutbox,
  pushBatches,
  researchRuns,
  researchOutbox,
  runs,
} from '../db/schema';
import { stableId } from '../contracts/memory';
import { config } from '../config';
export const queueName = 'interpret';
export const chroniclerQueue = 'chronicle';
export const researchQueue = 'research';
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
  await boss.createQueue(researchQueue, {
    retryLimit: 2,
    retryDelay: 5,
    expireInSeconds: 900,
  });
  await boss.updateQueue(researchQueue, {
    retryLimit: 2,
    retryDelay: 5,
    expireInSeconds: 900,
  });
  return boss;
}
export async function dispatchPending(boss: PgBoss) {
  const pending = await db
    .select()
    .from(outbox)
    .innerJoin(runs, eq(outbox.id, runs.id))
    .where(isNull(outbox.dispatchedAt))
    .limit(50);
  for (const row of pending) {
    const item = row.job_outbox,
      run = row.interpretation_runs;
    if (run.state === 'queued')
      await boss.send(
        queueName,
        { runId: item.id },
        { id: stableId(item.id, 'interpret', String(run.attempts)) },
      );
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
    .where(isNull(chroniclerOutbox.dispatchedAt))
    .limit(50);
  for (const row of pending) {
    const item = row.chronicler_outbox,
      batch = row.push_batches;
    if (batch.state === 'queued')
      await boss.send(
        chroniclerQueue,
        { pushId: item.id },
        { id: stableId(item.id, 'push-delivery', String(item.generation)) },
      );
    await db
      .update(chroniclerOutbox)
      .set({ dispatchedAt: new Date() })
      .where(
        and(
          eq(chroniclerOutbox.id, item.id),
          eq(chroniclerOutbox.generation, item.generation),
        ),
      );
  }
}

export async function dispatchResearch(boss: PgBoss) {
  const pending = await db
    .select()
    .from(researchOutbox)
    .innerJoin(researchRuns, eq(researchOutbox.id, researchRuns.id))
    .where(isNull(researchOutbox.dispatchedAt))
    .limit(50);
  for (const row of pending) {
    const run = row.research_runs;
    if (run.state === 'queued')
      await boss.send(
        researchQueue,
        { runId: run.id },
        {
          id: stableId(
            run.id,
            'research',
            String(row.research_outbox.generation),
          ),
        },
      );
    await db
      .update(researchOutbox)
      .set({ dispatchedAt: new Date() })
      .where(
        and(
          eq(researchOutbox.id, run.id),
          eq(researchOutbox.generation, row.research_outbox.generation),
        ),
      );
  }
}
