import { listUploads, memoryCount } from '../lib/server/services/uploads';
export async function load() {
  return { uploads: await listUploads(), memoryCount: await memoryCount() };
}
