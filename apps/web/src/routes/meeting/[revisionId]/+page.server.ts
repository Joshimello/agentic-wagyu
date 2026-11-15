import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/server/db/client';
import { revisions, uploads } from '../../../lib/server/db/schema';
import { id } from '../../../lib/server/contracts';

// Citations name a source revision. This sends the reader to that meeting's
// page, at the cited moment when ?t=<milliseconds> is given.
export async function load({
  params,
  url,
}: {
  params: { revisionId: string };
  url: URL;
}) {
  const parsed = id.safeParse(params.revisionId);
  if (!parsed.success) error(404, 'Meeting not found');
  const [row] = await db
    .select({
      uploadId: revisions.uploadId,
      current: uploads.currentRevisionId,
    })
    .from(revisions)
    .innerJoin(uploads, eq(uploads.id, revisions.uploadId))
    .where(eq(revisions.id, parsed.data));
  if (!row) error(404, 'Meeting not found');
  const query = new URLSearchParams();
  if (row.current !== parsed.data) query.set('revision', parsed.data);
  const t = url.searchParams.get('t');
  if (t && /^\d+$/.test(t)) query.set('t', t);
  redirect(307, `/staging/${row.uploadId}${query.size ? `?${query}` : ''}`);
}
