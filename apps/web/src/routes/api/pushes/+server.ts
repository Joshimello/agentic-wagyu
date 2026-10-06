import { createPush, listPushes } from '../../../lib/server/services/pushes';
export async function GET() {
  return Response.json(await listPushes());
}
export async function POST({ request }: { request: Request }) {
  try {
    const { checkpoints, plan, ...batch } = await createPush(
      await request.json(),
    );
    return Response.json(batch, {
      status: 202,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Push failed' },
      { status: 409 },
    );
  }
}
