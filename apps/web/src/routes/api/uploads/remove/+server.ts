import { removeUploads } from '../../../../lib/server/services/removal';

export async function POST({ request }: { request: Request }) {
  try {
    return Response.json(await removeUploads(await request.json()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not remove selected sources' }, { status: 409 });
  }
}
