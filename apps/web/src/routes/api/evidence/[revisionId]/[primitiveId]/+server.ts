import { evidenceView } from '../../../../../lib/server/services/memory';
import { id } from '../../../../../lib/server/contracts';
export async function GET({
  params,
  url,
}: {
  params: { revisionId: string; primitiveId: string };
  url: URL;
}) {
  try {
    return Response.json(
      await evidenceView(
        id.parse(params.revisionId),
        id.parse(params.primitiveId),
        url.searchParams.has('knownVersion')
          ? Number(url.searchParams.get('knownVersion'))
          : undefined,
      ),
    );
  } catch {
    return Response.json(
      { error: 'Evidence unavailable in this memory snapshot' },
      { status: 404 },
    );
  }
}
