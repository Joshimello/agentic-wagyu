import { error } from '@sveltejs/kit';
import { getUpload } from '../../../lib/server/services/uploads';
import { id } from '../../../lib/server/contracts';
import { organizationView } from '../../../lib/server/services/organization';
import { memorySnapshot } from '../../../lib/server/services/memory';
import { listSourceProjectNames } from '../../../lib/server/services/source-details';
export async function load({ params }: { params: { id: string } }) {
  try {
    const [source, organized, stagingProjects] = await Promise.all([
      getUpload(id.parse(params.id)),
      organizationView(),
      listSourceProjectNames(),
    ]);
    return {
      ...source,
      stagingProjects,
      projects: organized.projects.length
        ? organized.projects.map((project) => ({
            id: project.id,
            name: project.current.title,
          }))
        : (await memorySnapshot()).projects,
    };
  } catch {
    error(404, 'Upload not found');
  }
}
