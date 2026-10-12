import { z } from 'zod';
import { id } from '../../../../../lib/server/contracts';
import { changeComparison } from '../../../../../lib/server/services/changes';
export async function POST({
  params,
  request,
}: {
  params: { id: string };
  request: Request;
}) {
  try {
    const input = z
      .object({ generation: z.number().int().nonnegative() })
      .strict()
      .parse(await request.json());
    return Response.json(
      await changeComparison(id.parse(params.id), 'retry', input.generation),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not retry comparison',
      },
      { status: 409 },
    );
  }
}
