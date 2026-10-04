import { id } from '../../../../lib/server/contracts';
import { getUpload } from '../../../../lib/server/services/uploads';
export async function GET({ params }: { params: { id: string } }) {
  try {
    return Response.json(await getUpload(id.parse(params.id)));
  } catch {
    return Response.json({ error: 'Upload not found' }, { status: 404 });
  }
}
