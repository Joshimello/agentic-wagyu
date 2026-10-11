import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { researchRuns, researchOutbox, revisions, uploads } from '../db/schema';
import { researchInput, type ResearchScope } from '../contracts/research';
import { organizationSnapshot, reduceOrganization } from './organization';
import { ResearchCorpus } from '../agents/researcher/retrieval';
export async function loadResearchCorpus(scope: ResearchScope) {
  const snapshot = await organizationSnapshot({ knownVersion: scope.version });
  const ids = snapshot.admissions.map((a) => a.revisionId);
  const rows = ids.length
    ? await db
        .select({ stage: revisions.manifest, filename: uploads.filename })
        .from(revisions)
        .innerJoin(uploads, eq(revisions.uploadId, uploads.id))
        .where(inArray(revisions.id, ids))
    : [];
  return new ResearchCorpus(
    { snapshot, stages: new Map(rows.map((r) => [r.stage.id, r])) },
    scope,
  );
}
export async function createResearch(value: unknown) {
  const input = researchInput.parse(value);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(736503)`);
    const [existing] = await tx
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.idempotencyKey, input.idempotencyKey));
    if (existing) {
      if (
        JSON.stringify(researchInput.parse(existing.input)) !==
        JSON.stringify(input)
      )
        throw new Error(
          'Idempotency key belongs to a different question or scope',
        );
      return existing;
    }
    const snapshot = await organizationSnapshot(input),
      view = reduceOrganization(snapshot);
    if (input.projectId && !view.projects.some((p) => p.id === input.projectId))
      throw new Error('Project unavailable in selected snapshot');
    const scope: ResearchScope = {
      version: snapshot.version,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.effectiveAt ? { effectiveAt: input.effectiveAt } : {}),
    };
    const [run] = await tx
      .insert(researchRuns)
      .values({
        id: crypto.randomUUID(),
        idempotencyKey: input.idempotencyKey,
        input,
        scope,
      })
      .returning();
    await tx.insert(researchOutbox).values({ id: run.id });
    return run;
  });
}
export async function getResearch(id: string) {
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, id));
  if (!run) throw new Error('Research run not found');
  return run;
}
export async function listResearch() {
  return db
    .select({
      id: researchRuns.id,
      question: sql<string>`${researchRuns.input}->>'question'`,
      state: researchRuns.state,
      scope: researchRuns.scope,
      createdAt: researchRuns.createdAt,
    })
    .from(researchRuns)
    .orderBy(desc(researchRuns.createdAt))
    .limit(50);
}
export async function cancelResearch(id: string) {
  await db
    .update(researchRuns)
    .set({ state: 'canceled', progress: 'Canceled', updatedAt: new Date() })
    .where(
      and(
        eq(researchRuns.id, id),
        inArray(researchRuns.state, ['queued', 'processing', 'failed']),
      ),
    );
  return getResearch(id);
}
export async function retryResearch(id: string) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, id))
      .for('update');
    if (!run || !['failed', 'canceled'].includes(run.state))
      throw new Error('Only failed or canceled questions can be retried');
    await tx
      .update(researchRuns)
      .set({
        state: 'queued',
        error: null,
        progress: 'Waiting for Researcher',
        updatedAt: new Date(),
      })
      .where(eq(researchRuns.id, id));
    await tx
      .update(researchOutbox)
      .set({ dispatchedAt: null })
      .where(eq(researchOutbox.id, id));
    return { id, scope: run.scope };
  });
}
