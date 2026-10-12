import { id } from '../../../../../lib/server/contracts';
import { getProcessingDetails } from '../../../../../lib/server/services/processing';

export async function GET({
  params,
  url,
  request,
}: {
  params: { id: string };
  url: URL;
  request: Request;
}) {
  const uploadId = id.safeParse(params.id);
  const value = url.searchParams.get('runId');
  const runId = value === null ? null : id.safeParse(value);
  if (!uploadId.success || (runId && !runId.success))
    return Response.json(
      { error: 'Invalid upload or processing run' },
      { status: 400 },
    );
  try {
    return Response.json(
      await getProcessingDetails(
        uploadId.data,
        runId?.success ? runId.data : undefined,
        request.signal,
      ),
    );
  } catch (error) {
    const missing =
      error instanceof Error &&
      ['Upload not found', 'Processing run not found for this upload'].includes(
        error.message,
      );
    return Response.json(
      {
        error: missing
          ? 'Processing run not found for this upload'
          : 'Processing details are temporarily unavailable',
      },
      { status: missing ? 404 : 503 },
    );
  }
}
