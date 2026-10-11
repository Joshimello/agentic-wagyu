import { id } from '../../../../../lib/server/contracts';
import { cancelUpload } from '../../../../../lib/server/services/uploads';
export async function POST({ params }: { params: { id: string } }) {
  try {
    return Response.json(await cancelUpload(id.parse(params.id)));
  } catch {
    return Response.json(
      { error: 'Unable to cancel this interpretation' },
      { status: 409 },
    );
  }
}
