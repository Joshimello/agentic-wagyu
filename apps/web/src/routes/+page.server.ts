import { organizationView } from '../lib/server/services/organization';
import { memorySnapshot } from '../lib/server/services/memory';
import { listSelections } from '../lib/server/services/selections';
import { listUploads, memoryCount } from '../lib/server/services/uploads';
export async function load() {
  const organized = await organizationView();
  return {
    uploads: await listUploads(),
    memoryCount: await memoryCount(),
    selections: await listSelections(),
    projects: organized.projects.length
      ? organized.projects.map((p) => ({ id: p.id, name: p.current.title }))
      : (await memorySnapshot()).projects,
  };
}
