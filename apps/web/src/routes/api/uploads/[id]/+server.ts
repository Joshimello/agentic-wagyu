import { id } from '../../../../lib/server/contracts';
import { getUpload } from '../../../../lib/server/services/uploads';
import { sourceDetailsInput, updateSourceDetails } from '../../../../lib/server/services/source-details';
export async function GET({ params }: { params: { id: string } }) {
  try {
    return Response.json(await getUpload(id.parse(params.id)));
  } catch {
    return Response.json({ error: 'Upload not found' }, { status: 404 });
  }
}

export async function PATCH({ params, request }: { params: { id: string }; request: Request }) {
  const uploadId = id.safeParse(params.id);
  let value: unknown;
  try { value = await request.json(); } catch {
    return Response.json({ error: 'Invalid source details' }, { status: 400 });
  }
  const parsed = sourceDetailsInput.safeParse(value);
  if (!uploadId.success || !parsed.success)
    return Response.json({ error: 'Enter a name, a valid meeting date, and a project name of at most 500 characters' }, { status: 400 });
  try {
    await updateSourceDetails(uploadId.data, parsed.data);
    return Response.json({ saved: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Source details could not be saved' }, { status: 409 });
  }
}
