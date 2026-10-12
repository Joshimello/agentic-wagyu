import { id } from '../../../../../lib/server/contracts';
import { reviewChange } from '../../../../../lib/server/services/changes';
export async function POST({
  params,
  request,
}: {
  params: { id: string };
  request: Request;
}) {
  try {
    return Response.json(
      await reviewChange(id.parse(params.id), await request.json()),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not review proposal',
      },
      { status: 409 },
    );
  }
}
