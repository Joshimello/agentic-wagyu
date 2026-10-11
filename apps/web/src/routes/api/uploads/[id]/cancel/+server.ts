import { z } from 'zod';
import { id } from '../../../../../lib/server/contracts';
import { cancelUploadRun } from '../../../../../lib/server/services/uploads';

export async function POST({
  params,
  request,
}: {
  params: { id: string };
  request: Request;
}) {
  try {
    const { runId } = z
      .object({ runId: id })
      .strict()
      .parse(await request.json());
    return Response.json({
      run: await cancelUploadRun(id.parse(params.id), runId),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Cancellation failed' },
      {
        status:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : 404,
      },
    );
  }
}
