import {
  acceptUploadBatch,
  listUploads,
} from '../../../lib/server/services/uploads';
import { id } from '../../../lib/server/contracts';
import { failUploadSession } from '../../../lib/server/services/upload-sessions';
export async function GET() {
  return Response.json(await listUploads());
}
export async function POST({ request }: { request: Request }) {
  let sessionId: string | undefined;
  try {
    const session = new URL(request.url).searchParams.get('session');
    if (session) sessionId = id.parse(session);
    const form = await request.formData();
    const files = form.getAll('file');
    if (!files.length || !files.every((file) => file instanceof File))
      return Response.json({ error: 'Choose a file' }, { status: 400 });
    const result = await acceptUploadBatch(
      files as File[],
      {
        uploader: String(form.get('uploader') || 'local'),
        label: String(form.get('label') || ''),
        sourceTime: String(form.get('sourceTime') || ''),
        groupHint: String(form.get('groupHint') || ''),
      },
      { signal: request.signal, sessionId },
    );
    return Response.json({ ...result[0], uploads: result }, { status: 202 });
  } catch (e) {
    if (sessionId) await failUploadSession(sessionId);
    return Response.json(
      { error: e instanceof Error ? e.message : 'Upload failed' },
      { status: 400 },
    );
  }
}
