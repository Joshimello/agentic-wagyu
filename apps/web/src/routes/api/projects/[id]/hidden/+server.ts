import {
  hideProject,
  restoreProject,
} from '../../../../../lib/server/services/hidden-projects';

const failed = () =>
  Response.json({ error: 'Could not update this project' }, { status: 400 });
export async function POST({ params }: { params: { id: string } }) {
  try {
    await hideProject(params.id);
    return Response.json({ hidden: true });
  } catch {
    return failed();
  }
}
export async function DELETE({ params }: { params: { id: string } }) {
  try {
    await restoreProject(params.id);
    return Response.json({ hidden: false });
  } catch {
    return failed();
  }
}
