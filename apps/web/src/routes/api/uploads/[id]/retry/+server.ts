import { id } from '../../../../../lib/server/contracts';
import { retryUpload } from '../../../../../lib/server/services/uploads';
export async function POST({params}:{params:{id:string}}) {
  try { return Response.json({runId:await retryUpload(id.parse(params.id))},{status:202}); }
  catch (e) {return Response.json({error:e instanceof Error?e.message:'Retry failed'},{status:409});}
}
