import { id } from '../../../../lib/server/contracts';
import { z } from 'zod';
import {
  getResearch,
  cancelResearch,
  retryResearch,
} from '../../../../lib/server/services/research';
export async function GET({ params }: { params: { id: string } }) {
  try {
    return Response.json(await getResearch(id.parse(params.id)));
  } catch {
    return Response.json({ error: 'Research unavailable' }, { status: 404 });
  }
}
export async function POST({
  params,
  request,
}: {
  params: { id: string };
  request: Request;
}) {
  try {
    const value = z
      .object({
        action: z.enum(['retry', 'cancel']),
        generation: z.number().int().nonnegative().optional(),
      })
      .strict()
      .parse(await request.json());
    return Response.json(
      await (value.action === 'retry'
        ? retryResearch(id.parse(params.id))
        : cancelResearch(id.parse(params.id), value.generation)),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Action failed' },
      { status: 409 },
    );
  }
}
