import { createPush, listPushes } from '../../../lib/server/services/pushes';
export async function GET() {
  return Response.json(await listPushes());
}
export async function POST({ request }: { request: Request }) {
  try {
    return Response.json(await createPush(await request.json()), {
      status: 202,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Push failed' },
      { status: 409 },
    );
  }
}
