import {
  acceptUploadBatch,
  listUploads,
} from '../../../lib/server/services/uploads';
export async function GET() {
  return Response.json(await listUploads());
}
export async function POST({ request }: { request: Request }) {
  try {
    const form = await request.formData();
    const files = form.getAll('file');
    if (!files.length || !files.every((file) => file instanceof File))
      return Response.json({ error: 'Choose a file' }, { status: 400 });
    const result = await acceptUploadBatch(files as File[], {
      uploader: String(form.get('uploader') || 'local'),
      label: String(form.get('label') || ''),
      sourceTime: String(form.get('sourceTime') || ''),
      groupHint: String(form.get('groupHint') || ''),
    });
    return Response.json({ ...result[0], uploads: result }, { status: 202 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Upload failed' },
      { status: 400 },
    );
  }
}
