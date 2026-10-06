import { getPush } from '../../../lib/server/services/pushes';
import { id } from '../../../lib/server/contracts';
export async function load({ params }: { params: { id: string } }) {
  return { push: await getPush(id.parse(params.id)) };
}
