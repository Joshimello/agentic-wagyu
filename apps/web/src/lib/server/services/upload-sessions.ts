import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { uploadSessions } from '../db/schema';
import { id } from '../contracts';
import { cancelUploadRun } from './uploads';

export const uploadSessionInput = z
  .object({
    id,
    filenames: z.array(z.string().trim().min(1).max(255)).min(1).max(20),
  })
  .strict();
export async function beginUploadSession(value: unknown) {
  const input = uploadSessionInput.parse(value);
  await db.insert(uploadSessions).values(input).onConflictDoNothing();
  return getUploadSession(input.id);
}
export async function getUploadSession(sessionId: string) {
  const [session] = await db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, id.parse(sessionId)));
  if (!session) throw new Error('Upload not found');
  return session;
}
export async function failUploadSession(sessionId: string) {
  await db
    .update(uploadSessions)
    .set({ state: 'failed', updatedAt: new Date() })
    .where(
      and(
        eq(uploadSessions.id, id.parse(sessionId)),
        eq(uploadSessions.state, 'uploading'),
      ),
    );
}
export async function cancelUploadSession(sessionId: string) {
  id.parse(sessionId);
  const session = await db.transaction(async (tx) => {
    // A cancellation can arrive before the begin request or after acceptance.
    await tx
      .insert(uploadSessions)
      .values({ id: sessionId, state: 'canceled' })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, sessionId))
      .for('update');
    if (row.state === 'canceled') return row;
    const [canceled] = await tx
      .update(uploadSessions)
      .set({ state: 'canceled', updatedAt: new Date() })
      .where(eq(uploadSessions.id, sessionId))
      .returning();
    return canceled;
  });
  await Promise.all(
    session.accepted.map((source) =>
      cancelUploadRun(source.uploadId, source.runId),
    ),
  );
  return session;
}
