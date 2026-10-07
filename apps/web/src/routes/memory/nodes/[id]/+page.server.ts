import { error } from '@sveltejs/kit';
import { openMemoryNode } from '../../../../lib/server/services/organization';
import { memoryOptions } from '../../../../lib/server/services/memory';
import { id } from '../../../../lib/server/contracts';
export async function load({
  params,
  url,
}: {
  params: { id: string };
  url: URL;
}) {
  try {
    return await openMemoryNode(id.parse(params.id), {
      ...memoryOptions(url),
      versionId: url.searchParams.get('versionId')
        ? id.parse(url.searchParams.get('versionId'))
        : undefined,
    });
  } catch {
    error(404, 'Memory node unavailable in this snapshot');
  }
}
