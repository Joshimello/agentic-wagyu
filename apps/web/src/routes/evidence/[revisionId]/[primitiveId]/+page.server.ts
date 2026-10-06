import { evidenceView } from '../../../../lib/server/services/memory';
import { id } from '../../../../lib/server/contracts';
export async function load({
  params,
  url,
}: {
  params: { revisionId: string; primitiveId: string };
  url: URL;
}) {
  return evidenceView(
    id.parse(params.revisionId),
    id.parse(params.primitiveId),
    url.searchParams.has('knownVersion')
      ? Number(url.searchParams.get('knownVersion'))
      : undefined,
  );
}
