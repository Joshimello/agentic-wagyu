import {
  startTranslationQueue,
  dispatchTranslations,
  reconcileTranslations,
  translationQueue,
} from '../src/lib/server/jobs/translations';
import { translateRevision } from '../src/lib/server/agents/translation';
import { sqlClient } from '../src/lib/server/db/client';
import { recoverInterrupted } from '../src/lib/server/jobs/operation';

const boss = await startTranslationQueue();
await recoverInterrupted(['translation']);
await boss.work<{ translationId: string }>(
  translationQueue,
  { batchSize: 1 },
  async (jobs) => {
    for (const job of jobs)
      await translateRevision(job.data.translationId, {
        signal: job.signal,
        retrying: job.retryCount < 3,
      });
  },
);
let stopping = false;
let nextReconciliation = 0;
const pump = (async () => {
  while (!stopping) {
    try {
      await dispatchTranslations(boss);
      if (Date.now() >= nextReconciliation) {
        await recoverInterrupted(['translation']);
        await reconcileTranslations(boss);
        nextReconciliation = Date.now() + 30000;
      }
    } catch {
      console.error('Translation dispatch deferred; durable outbox will retry');
    }
    await Bun.sleep(1000);
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
console.log('Transcript translation worker ready');
