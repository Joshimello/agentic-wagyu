import { evidenceView } from '../../../../lib/server/services/memory';
import { id } from '../../../../lib/server/contracts';
export async function load({
  params,
  url,
}: {
  params: { revisionId: string; primitiveId: string };
  url: URL;
}) {
  const data = await evidenceView(
    id.parse(params.revisionId),
    id.parse(params.primitiveId),
    url.searchParams.has('knownVersion')
      ? Number(url.searchParams.get('knownVersion'))
      : undefined,
  );
  const first = url.searchParams.has('first')
    ? Number(url.searchParams.get('first'))
    : null;
  const last = url.searchParams.has('last')
    ? Number(url.searchParams.get('last'))
    : null;
  if (first !== null || last !== null) {
    if (
      data.primitive.kind !== 'text' ||
      first === null ||
      last === null ||
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      first < 0 ||
      last < first ||
      last > data.primitive.text.length
    )
      throw new Error('Invalid cited text range');
  }
  return {
    ...data,
    excerpt:
      data.primitive.kind === 'text' && first !== null && last !== null
        ? data.primitive.text.slice(first, last)
        : null,
  };
}
