import { id } from '../../../../lib/server/contracts';
import {
  getResearch,
  cancelResearch,
  retryResearch,
} from '../../../../lib/server/services/research';
export async function GET({ params }: { params: { id: string } }) {
  try {
    return Response.json(await getResearch(id.parse(params.id)));
  } catch {
    return Response.json({ error: 'Research unavailable' }, { status: 404 });
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
    const value = await request.json();
    if (value.action !== 'retry' && value.action !== 'cancel')
      throw new Error('Choose retry or cancel');
    return Response.json(
      await (value.action === 'retry' ? retryResearch : cancelResearch)(
        id.parse(params.id),
      ),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Action failed' },
      { status: 409 },
    );
  }
}
