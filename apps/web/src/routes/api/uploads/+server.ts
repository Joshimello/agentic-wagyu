import {
  acceptUpload,
  listUploads,
} from '../../../lib/server/services/uploads';
export async function GET() {
  return Response.json(await listUploads());
}
export async function POST({ request }: { request: Request }) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File))
      return Response.json({ error: 'Choose a file' }, { status: 400 });
    const result = await acceptUpload(file, {
      uploader: String(form.get('uploader') || 'local'),
      label: String(form.get('label') || ''),
      sourceTime: String(form.get('sourceTime') || ''),
    });
    return Response.json(result, { status: 202 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Upload failed' },
      { status: 400 },
    );
  }
}
