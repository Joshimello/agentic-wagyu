import { id } from '../../../lib/server/contracts';
import { getResearch } from '../../../lib/server/services/research';
import { servedModels } from '../../../lib/server/llm/usage';
export async function load({ params }: { params: { id: string } }) {
  const runId = id.parse(params.id);
  return {
    run: await getResearch(runId),
    served: await servedModels('research', runId),
  };
}
