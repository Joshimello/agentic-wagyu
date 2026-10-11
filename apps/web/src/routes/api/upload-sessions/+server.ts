import { beginUploadSession } from '../../../lib/server/services/upload-sessions';
export async function POST({ request }: { request: Request }) {
  try {
    return Response.json(await beginUploadSession(await request.json()), {
      status: 201,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not begin upload',
      },
      { status: 400 },
    );
  }
}
