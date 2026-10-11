import { db } from '../../../../lib/server/db/client';
import { revisions } from '../../../../lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  spanPartsFromRange,
  spanText,
} from '../../../../lib/server/services/evidence-spans';
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
  let spanLocator: typeof data.primitive.locator | null = null;
  const through = url.searchParams.get('through');
  if (through) {
    if (first === null || last === null)
      throw new Error('Transcript span requires exact boundaries');
    const [revision] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, data.revisionId));
    const parts = spanPartsFromRange(
      revision.manifest,
      data.primitive.id,
      id.parse(through),
      first,
      last,
    );
    const tail = revision.manifest.primitives.find(
      (p) => p.id === parts.at(-1)!.primitiveId,
    );
    if (
      data.primitive.locator.kind !== 'media' ||
      tail?.locator.kind !== 'media'
    )
      throw new Error('Transcript span has invalid timestamps');
    spanLocator = { ...data.primitive.locator, endMs: tail.locator.endMs };
    return {
      ...data,
      spanLocator,
      excerpt: spanText(revision.manifest, parts),
    };
  }
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
    spanLocator,
    excerpt:
      data.primitive.kind === 'text' && first !== null && last !== null
        ? data.primitive.text.slice(first, last)
        : null,
  };
}
