import { cancelUploadSession } from '../../../../../lib/server/services/upload-sessions';
export async function POST({ params }: { params: { id: string } }) {
  try {
    return Response.json(await cancelUploadSession(params.id));
  } catch {
    return Response.json(
      { error: 'Could not cancel this upload. Try again.' },
      { status: 409 },
    );
  }
}
