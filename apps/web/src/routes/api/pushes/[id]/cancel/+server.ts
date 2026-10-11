import { id } from '../../../../../lib/server/contracts';
import { cancelPush } from '../../../../../lib/server/services/pushes';
export async function POST({ params }: { params: { id: string } }) {
  try {
    const { plan, checkpoints, ...batch } = await cancelPush(
      id.parse(params.id),
    );
    return Response.json(batch);
  } catch {
    return Response.json(
      { error: 'Unable to cancel this push' },
      { status: 409 },
    );
  }
}
