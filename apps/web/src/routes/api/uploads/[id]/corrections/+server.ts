import { id } from '../../../../../lib/server/contracts';
import { correctStage } from '../../../../../lib/server/services/staging';
export async function POST({
  params,
  request,
}: {
  params: { id: string };
  request: Request;
}) {
  try {
    return Response.json(
      await correctStage(id.parse(params.id), await request.json()),
      { status: 201 },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Correction failed' },
      { status: 409 },
    );
  }
}
