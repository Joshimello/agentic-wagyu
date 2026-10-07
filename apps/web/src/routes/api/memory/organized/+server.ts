import { organizationView } from '../../../../lib/server/services/organization';
import { memoryOptions } from '../../../../lib/server/services/memory';
export async function GET({ url }: { url: URL }) {
  try {
    return Response.json(await organizationView(memoryOptions(url)));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Memory unavailable' },
      { status: 400 },
    );
  }
}
