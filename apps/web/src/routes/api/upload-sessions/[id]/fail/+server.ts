import {
  failUploadSession,
  getUploadSession,
} from '../../../../../lib/server/services/upload-sessions';
export async function POST({ params }: { params: { id: string } }) {
  try {
    await failUploadSession(params.id);
    return Response.json(await getUploadSession(params.id));
  } catch {
    return Response.json(
      { error: 'Could not check upload outcome' },
      { status: 409 },
    );
  }
}
