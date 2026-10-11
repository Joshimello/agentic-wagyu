import { getUploadSession } from '../../../../lib/server/services/upload-sessions';
export async function GET({ params }: { params: { id: string } }) {
  try {
    return Response.json(await getUploadSession(params.id));
  } catch {
    return Response.json({ error: 'Upload not found' }, { status: 404 });
  }
}
