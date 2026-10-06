import { memorySnapshot } from '../lib/server/services/memory';
import { listSelections } from '../lib/server/services/selections';
import { listUploads, memoryCount } from '../lib/server/services/uploads';
export async function load() {
  return {
    uploads: await listUploads(),
    memoryCount: await memoryCount(),
    selections: await listSelections(),
    projects: (await memorySnapshot()).projects,
  };
}
