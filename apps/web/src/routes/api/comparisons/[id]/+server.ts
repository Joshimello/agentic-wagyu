import { id } from '../../../../lib/server/contracts';
import { getComparison } from '../../../../lib/server/services/changes';
export async function GET({ params }: { params: { id: string } }) {
  try {
    return Response.json(await getComparison(id.parse(params.id)));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Comparison unavailable',
      },
      { status: 404 },
    );
  }
}
