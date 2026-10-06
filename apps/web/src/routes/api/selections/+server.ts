import {
  listSelections,
  selectRevision,
  removeSelection,
} from '../../../lib/server/services/selections';
export async function GET() {
  return Response.json(await listSelections());
}
export async function POST({ request }: { request: Request }) {
  try {
    return Response.json(await selectRevision(await request.json()));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Selection failed' },
      { status: 400 },
    );
  }
}
export async function DELETE({ request }: { request: Request }) {
  try {
    const { uploadId } = await request.json();
    return Response.json(await removeSelection(uploadId));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Removal failed' },
      { status: 400 },
    );
  }
}
