import { id } from '../../../../../lib/server/contracts';
import { getUpload } from '../../../../../lib/server/services/uploads';
import { exportMarkdown } from '../../../../../lib/server/services/staging';
import { exportBundle } from '../../../../../lib/server/services/bundle';
export async function GET({
  params,
  url,
}: {
  params: { id: string };
  url: URL;
}) {
  try {
    const detail = await getUpload(id.parse(params.id));
    const revisionId =
      url.searchParams.get('revision') ?? detail.upload.currentRevisionId;
    const revision = detail.revisions.find((r) => r.id === revisionId);
    if (!revision) return new Response('No staging revision', { status: 404 });
    if (url.searchParams.get('format') === 'json')
      return Response.json(revision.manifest, {
        headers: {
          'Content-Disposition': 'attachment; filename="staging.json"',
        },
      });
    if (url.searchParams.get('format') === 'zip')
      return new Response(
        new Uint8Array(
          await exportBundle(revision.manifest, detail.upload.filename),
        ).buffer,
        {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="staging.zip"',
          },
        },
      );
    return new Response(
      exportMarkdown(
        revision.manifest,
        detail.upload.filename,
        'http://localhost:5173',
      ),
      {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="staging.md"',
        },
      },
    );
  } catch {
    return new Response('Upload not found', { status: 404 });
  }
}
