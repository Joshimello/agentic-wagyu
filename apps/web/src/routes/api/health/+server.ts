import { sqlClient } from '../../../lib/server/db/client';
export async function GET() {
  try {
    await sqlClient`select 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
