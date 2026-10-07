import { searchOrganization } from '../../../../../lib/server/services/organization';
import { memoryOptions } from '../../../../../lib/server/services/memory';
import { id } from '../../../../../lib/server/contracts';
export async function GET({ url }: { url: URL }) {
  try {
    return Response.json(
      await searchOrganization(url.searchParams.get('q') ?? '', {
        ...memoryOptions(url),
        projectId: url.searchParams.get('projectId')
          ? id.parse(url.searchParams.get('projectId'))
          : undefined,
        limit: url.searchParams.get('limit')
          ? Number(url.searchParams.get('limit'))
          : undefined,
      }),
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Search unavailable' },
      { status: 400 },
    );
  }
}
