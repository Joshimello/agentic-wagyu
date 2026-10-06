import { getPush } from '../../../../lib/server/services/pushes';
import { id } from '../../../../lib/server/contracts';
export async function GET({ params }: { params: { id: string } }) {
  try {
    return Response.json(await getPush(id.parse(params.id)));
  } catch {
    return Response.json({ error: 'Push not found' }, { status: 404 });
  }
}
