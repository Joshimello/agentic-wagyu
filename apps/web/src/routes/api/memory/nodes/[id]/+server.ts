import { openMemoryNode } from '../../../../../lib/server/services/organization';
import { memoryOptions } from '../../../../../lib/server/services/memory';
import { id } from '../../../../../lib/server/contracts';
export async function GET({
  params,
  url,
}: {
  params: { id: string };
  url: URL;
}) {
  try {
    return Response.json(
      await openMemoryNode(id.parse(params.id), {
        ...memoryOptions(url),
        versionId: url.searchParams.get('versionId')
          ? id.parse(url.searchParams.get('versionId'))
          : undefined,
      }),
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Node unavailable' },
      { status: 400 },
    );
  }
}
