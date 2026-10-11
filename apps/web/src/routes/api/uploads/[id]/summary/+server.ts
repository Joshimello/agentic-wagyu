import {
  getSummary,
  requestSummary,
} from '../../../../../lib/server/services/summaries';
export async function GET({
  params,
  url,
}: {
  params: { id: string };
  url: URL;
}) {
  try {
    return Response.json(
      await getSummary(params.id, url.searchParams.get('revision') ?? ''),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Summary unavailable' },
      { status: 404 },
    );
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
    return Response.json(
      await requestSummary(params.id, await request.json()),
      { status: 202 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not request summary',
      },
      { status: 409 },
    );
  }
}
