import { error } from '@sveltejs/kit';
import { getUpload } from '../../../lib/server/services/uploads';
import { id } from '../../../lib/server/contracts';
export async function load({ params }: { params: { id: string } }) {
  try {
    return await getUpload(id.parse(params.id));
  } catch {
    error(404, 'Upload not found');
  }
}
