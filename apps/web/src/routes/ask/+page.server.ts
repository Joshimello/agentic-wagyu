import { organizationView } from '../../lib/server/services/organization';
import { listResearch } from '../../lib/server/services/research';
export async function load() {
  const [memory, runs] = await Promise.all([
    organizationView(),
    listResearch(),
  ]);
  return {
    version: memory.version,
    projects: memory.projects.map((p) => ({
      id: p.id,
      title: p.current.title,
    })),
    commits: memory.commits,
    runs,
  };
}
