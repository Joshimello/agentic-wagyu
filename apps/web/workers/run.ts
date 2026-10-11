import {
  startQueue,
  dispatchPending,
  queueName,
  chroniclerQueue,
  dispatchPushes,
  dispatchResearch,
  researchQueue,
} from '../src/lib/server/jobs/queue';
import { research } from '../src/lib/server/agents/researcher';
import { chronicle } from '../src/lib/server/agents/chronicler';
import { interpret } from '../src/lib/server/agents/interpreter';
import { sqlClient } from '../src/lib/server/db/client';
import { recoverInterrupted } from '../src/lib/server/jobs/operation';

const boss = await startQueue();
await recoverInterrupted();
await boss.work<{ runId: string }>(
  queueName,
  { batchSize: 1 },
  async (jobs) => {
    for (const job of jobs) await interpret(job.data.runId);
  },
);
await boss.work<{ pushId: string }>(
  chroniclerQueue,
  { batchSize: 1 },
  async (jobs) => {
    for (const job of jobs) await chronicle(job.data.pushId);
  },
);
await boss.work<{ runId: string }>(
  researchQueue,
  { batchSize: 1 },
  async (jobs) => {
    for (const job of jobs) await research(job.data.runId);
  },
);
let stopping = false;
let nextRecovery = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pump = (async () => {
  while (!stopping) {
    try {
      if (Date.now() >= nextRecovery) {
        await recoverInterrupted();
        nextRecovery = Date.now() + 30000;
      }
      await dispatchResearch(boss);
      await dispatchPending(boss);
      await dispatchPushes(boss);
    } catch {
      console.error('Dispatch deferred; durable outbox will retry');
    }
    await sleep(1000);
  }
})();
async function stop() {
  if (stopping) return;
  stopping = true;
  await pump;
  await boss.stop({ graceful: true, timeout: 30000 });
  await sqlClient.end();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
console.log('Interpreter, Chronicler and Researcher worker ready');
