import {
  startQueue,
  dispatchPending,
  queueName,
} from '../src/lib/server/jobs/queue';
import { interpret } from '../src/lib/server/agents/interpreter';
import { sqlClient } from '../src/lib/server/db/client';

const boss = await startQueue();
await boss.work<{ runId: string }>(
  queueName,
  { batchSize: 1 },
  async (jobs) => {
    for (const job of jobs) await interpret(job.data.runId);
  },
);
let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pump = (async () => {
  while (!stopping) {
    try {
      await dispatchPending(boss);
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
console.log('Interpreter worker ready');
