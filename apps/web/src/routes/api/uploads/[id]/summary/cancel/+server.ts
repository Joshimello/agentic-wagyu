import { z } from 'zod';
import { id } from '../../../../../../lib/server/contracts';
import { cancelSummary } from '../../../../../../lib/server/services/summaries';
export async function POST({
  params,
  request,
}: {
  params: { id: string };
  request: Request;
}) {
  try {
    const { summaryId, generation } = z
      .object({
        summaryId: id,
        generation: z.number().int().nonnegative().optional(),
      })
      .strict()
      .parse(await request.json());
    return Response.json(await cancelSummary(params.id, summaryId, generation));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not cancel summary',
      },
      { status: 409 },
    );
  }
}
