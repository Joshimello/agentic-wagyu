import { retryPush } from '../../../../../lib/server/services/pushes';
import { id } from '../../../../../lib/server/contracts';
export async function POST({ params }: { params: { id: string } }) {
  try {
    const { checkpoints, plan, ...batch } = await retryPush(
      id.parse(params.id),
    );
    return Response.json(batch, { status: 202 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Retry failed' },
      { status: 409 },
    );
  }
}
