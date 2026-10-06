import { memoryView, memoryOptions } from '../../lib/server/services/memory';
import { listPushes } from '../../lib/server/services/pushes';
export async function load({ url }: { url: URL }) {
  return {
    memory: await memoryView(memoryOptions(url)),
    pushes: await listPushes(),
  };
}
