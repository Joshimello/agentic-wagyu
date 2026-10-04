import { sqlClient } from './lib/server/db/client';
// The Bun adapter emits this after draining requests; workers manage their own shutdown.
process.once('sveltekit:shutdown', async () => {
  await sqlClient.end({ timeout: 5 });
});
