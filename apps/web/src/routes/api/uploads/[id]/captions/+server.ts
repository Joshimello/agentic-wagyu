import { id } from '../../../../../lib/server/contracts';
import { getUpload } from '../../../../../lib/server/services/uploads';
const timestamp = (ms: number) =>
  `${Math.floor(ms / 3600000)
    .toString()
    .padStart(
      2,
      '0',
    )}:${(Math.floor(ms / 60000) % 60).toString().padStart(2, '0')}:${(Math.floor(ms / 1000) % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`;
export async function GET({
  params,
  url,
}: {
  params: { id: string };
  url: URL;
}) {
  try {
    const detail = await getUpload(id.parse(params.id));
    const revision = detail.revisions.find(
      (r) =>
        r.id ===
        (url.searchParams.get('revision') ?? detail.upload.currentRevisionId),
    );
    if (!revision) return new Response('Not found', { status: 404 });
    const cues = revision.manifest.primitives.flatMap((p) =>
      p.kind === 'text' && p.locator.kind === 'media'
        ? [
            `${timestamp(p.locator.startMs)} --> ${timestamp(p.locator.endMs)}\n${p.speaker ?? ''}: ${p.text.replace(/[<>]/g, '').replace(/\n\n/g, '\n')}`,
          ]
        : [],
    );
    return new Response('WEBVTT\n\n' + cues.join('\n\n'), {
      headers: { 'Content-Type': 'text/vtt; charset=utf-8' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
