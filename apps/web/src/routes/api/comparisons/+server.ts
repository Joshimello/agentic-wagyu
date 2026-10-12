import {
  createComparison,
  listComparisons,
  comparisonChoices,
} from '../../../lib/server/services/changes';
export async function GET() {
  return Response.json({
    choices: await comparisonChoices(),
    comparisons: await listComparisons(),
  });
}
export async function POST({ request }: { request: Request }) {
  try {
    return Response.json(await createComparison(await request.json()), {
      status: 202,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not compare meetings',
      },
      { status: 400 },
    );
  }
}
