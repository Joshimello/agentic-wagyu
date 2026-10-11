import { id } from '../../../lib/server/contracts';
import { getResearch } from '../../../lib/server/services/research';
export async function load({ params }: { params: { id: string } }) {
  return { run: await getResearch(id.parse(params.id)) };
}
