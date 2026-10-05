import { id } from '../../../../../lib/server/contracts';
import { retryUpload } from '../../../../../lib/server/services/uploads';
export async function POST({
  params,
  request,
}: {
  params: { id: string };
  request: Request;
}) {
  try {
    const value = request.headers
      .get('content-type')
      ?.includes('application/json')
      ? await request.json()
      : {};
    const inputRevisionId =
      value.inputRevisionId === undefined
        ? undefined
        : id.parse(value.inputRevisionId);
    return Response.json(
      { runId: await retryUpload(id.parse(params.id), inputRevisionId) },
      { status: 202 },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Retry failed' },
      { status: 409 },
    );
  }
}
