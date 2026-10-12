import { id } from '../../../lib/server/contracts';
import { getComparison } from '../../../lib/server/services/changes';
export async function load({ params }: { params: { id: string } }) {
  return getComparison(id.parse(params.id));
}
