import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { hiddenProjects } from '../db/schema';
import { id } from '../contracts';

/** Projects the user removed from the workspace lists; nothing is deleted. */
export async function hiddenProjectIds() {
  const rows = await db.select().from(hiddenProjects);
  return new Set(rows.map((row) => row.nodeId));
}
export async function hideProject(value: unknown) {
  await db
    .insert(hiddenProjects)
    .values({ nodeId: id.parse(value) })
    .onConflictDoNothing();
}
export async function restoreProject(value: unknown) {
  await db.delete(hiddenProjects).where(eq(hiddenProjects.nodeId, id.parse(value)));
}
