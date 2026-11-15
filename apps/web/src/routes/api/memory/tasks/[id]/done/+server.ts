import { setTaskDone } from '../../../../../../lib/server/services/memory-map';

const set = (isDone: boolean) =>
  async function ({ params }: { params: { id: string } }) {
    try {
      await setTaskDone(params.id, isDone);
      return Response.json({ done: isDone });
    } catch {
      return Response.json(
        { error: 'Could not update this task' },
        { status: 400 },
      );
    }
  };
export const POST = set(true);
export const DELETE = set(false);
