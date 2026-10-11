import { listActivity } from '../../../lib/server/services/activity';
export async function GET() {
  return Response.json(await listActivity(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
