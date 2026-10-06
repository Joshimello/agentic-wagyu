import { memoryView, memoryOptions } from '../../../lib/server/services/memory';
export async function GET({ url }: { url: URL }) {
  try {
    return Response.json(await memoryView(memoryOptions(url)));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Memory unavailable' },
      { status: 400 },
    );
  }
}
