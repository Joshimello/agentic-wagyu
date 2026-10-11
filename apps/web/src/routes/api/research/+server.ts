import {
  createResearch,
  listResearch,
} from '../../../lib/server/services/research';
export async function GET() {
  return Response.json(await listResearch());
}
export async function POST({ request }: { request: Request }) {
  try {
    return Response.json(await createResearch(await request.json()), {
      status: 202,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not create question',
      },
      { status: 400 },
    );
  }
}
