import { z } from 'zod';
import { id } from '../../../../../lib/server/contracts';
import { cancelPush } from '../../../../../lib/server/services/pushes';

export async function POST({ params }: { params: { id: string } }) {
  try {
    return Response.json(await cancelPush(id.parse(params.id)));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Cancellation failed' },
      { status: error instanceof z.ZodError ? 400 : 404 },
    );
  }
}
