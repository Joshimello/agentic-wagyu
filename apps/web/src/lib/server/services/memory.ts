import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  memoryCommits,
  memoryProjects,
  memoryEntities,
  statements,
  statementVersions,
  statementRelations,
  evidenceAdmissions,
  knowledgeEvents,
  revisions,
  uploads,
  pushBatches,
} from '../db/schema';
import type { Snapshot, StatementVersion } from '../contracts/memory';
import { date } from '../contracts/memory';

export async function memorySnapshot(
  options: { knownVersion?: number; knownAt?: string } = {},
): Promise<Snapshot> {
  let commits = await db
    .select()
    .from(memoryCommits)
    .orderBy(asc(memoryCommits.version));
  if (options.knownAt) {
    const cutoff = new Date(options.knownAt);
    if (!Number.isFinite(cutoff.getTime()))
      throw new Error('Invalid recorded-time cutoff');
    commits = commits.filter((c) => c.createdAt <= cutoff);
  }
  const current = commits.at(-1)?.version ?? 0;
  const version = options.knownVersion ?? current;
  if (!Number.isSafeInteger(version) || version < 0 || version > current)
    throw new Error('Unavailable memory version');
  const [
    projects,
    entities,
    identity,
    versions,
    relations,
    admissions,
    events,
  ] = await Promise.all([
    db
      .select()
      .from(memoryProjects)
      .where(lte(memoryProjects.createdVersion, version)),
    db
      .select()
      .from(memoryEntities)
      .where(lte(memoryEntities.createdVersion, version)),
    db.select().from(statements).where(lte(statements.createdVersion, version)),
    db
      .select()
      .from(statementVersions)
      .where(lte(statementVersions.commitVersion, version)),
    db
      .select()
      .from(statementRelations)
      .where(lte(statementRelations.commitVersion, version)),
    db
      .select()
      .from(evidenceAdmissions)
      .where(lte(evidenceAdmissions.commitVersion, version)),
    db
      .select()
      .from(knowledgeEvents)
      .where(lte(knowledgeEvents.commitVersion, version)),
  ]);
  return {
    version,
    projects,
    entities,
    statements: identity,
    versions,
    relations,
    admissions,
    events,
    commits: commits
      .filter((c) => c.version <= version)
      .map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
  };
}
/** Rebuildable projection: first restrict recorded knowledge, then apply source corrections and effective time. */
export function reduceMemory(
  snapshot: Snapshot,
  options: { effectiveDate?: string; projectId?: string } = {},
) {
  if (options.effectiveDate) date.parse(options.effectiveDate);
  const known = snapshot.version;
  const latest = new Map<string, (typeof snapshot.admissions)[number]>();
  for (const a of snapshot.admissions
    .filter((a) => a.commitVersion <= known)
    .sort((a, b) => a.commitVersion - b.commitVersion))
    latest.set(a.uploadId, a);
  const admission = new Map(
    snapshot.admissions
      .filter((a) => a.commitVersion <= known)
      .map((a) => [a.revisionId, a]),
  );
  const recorded = snapshot.versions.filter((v) => v.commitVersion <= known);
  const activeEvidence = (v: StatementVersion) =>
    v.evidence.filter((e) => {
      const a = admission.get(e.revisionId);
      return a && latest.get(a.uploadId)?.revisionId === e.revisionId;
    });
  const effective = recorded.filter(
    (v) =>
      !options.effectiveDate ||
      v.effectiveDate === null ||
      v.effectiveDate <= options.effectiveDate,
  );
  const active = effective.filter((v) => activeEvidence(v).length);
  const byVersion = new Map(active.map((v) => [v.id, v]));
  const relations = snapshot.relations.filter(
    (r) =>
      r.commitVersion <= known &&
      byVersion.has(r.fromVersionId) &&
      byVersion.has(r.toVersionId),
  );
  const superseded = new Set(
    relations.filter((r) => r.kind === 'supersede').map((r) => r.toVersionId),
  );
  const conflicted = new Set(
    relations
      .filter((r) => r.kind === 'conflict')
      .flatMap((r) => [r.fromVersionId, r.toVersionId]),
  );
  const projected = snapshot.statements
    .filter(
      (s) =>
        s.createdVersion <= known &&
        (!options.projectId || s.projectId === options.projectId),
    )
    .map((statement) => {
      const history = recorded
        .filter((v) => v.statementId === statement.id)
        .sort(
          (a, b) =>
            a.commitVersion - b.commitVersion || a.id.localeCompare(b.id),
        );
      const candidates = active
        .filter((v) => v.statementId === statement.id)
        .sort((a, b) =>
          a.effectiveDate && b.effectiveDate
            ? a.effectiveDate.localeCompare(b.effectiveDate) ||
              a.commitVersion - b.commitVersion
            : a.commitVersion - b.commitVersion || a.id.localeCompare(b.id),
        );
      const current =
        candidates.filter((v) => !superseded.has(v.id)).at(-1) ??
        candidates.at(-1) ??
        history.at(-1)!;
      const status = !effective.some((v) => v.statementId === statement.id)
        ? 'future'
        : !candidates.length
          ? 'withdrawn'
          : candidates.every((v) => superseded.has(v.id))
            ? 'superseded'
            : candidates.some((v) => conflicted.has(v.id))
              ? 'conflicted'
              : 'active';
      return {
        ...statement,
        current,
        history,
        status,
        evidence: current ? activeEvidence(current) : [],
        dateUncertain: current?.effectiveDate === null,
      };
    });
  const projects = snapshot.projects.filter(
    (p) =>
      p.createdVersion <= known &&
      (!options.projectId || p.id === options.projectId),
  );
  return {
    version: known,
    projects,
    entities: snapshot.entities.filter(
      (e) =>
        e.createdVersion <= known &&
        (!options.projectId || e.projectId === options.projectId),
    ),
    statements: projected,
    relations,
    events: snapshot.events.filter((e) => e.commitVersion <= known),
    commits: snapshot.commits.filter((c) => c.version <= known),
    effectiveDate: options.effectiveDate ?? null,
  };
}
export async function memoryView(
  options: {
    knownVersion?: number;
    knownAt?: string;
    effectiveDate?: string;
    projectId?: string;
  } = {},
) {
  return reduceMemory(await memorySnapshot(options), options);
}
export async function memoryRelationship(
  uploadId: string,
  currentRevisionId: string | null,
) {
  const admitted = await db
    .select()
    .from(evidenceAdmissions)
    .where(eq(evidenceAdmissions.uploadId, uploadId))
    .orderBy(desc(evidenceAdmissions.commitVersion));
  const pending = await db
    .select({
      id: pushBatches.id,
      input: pushBatches.input,
      state: pushBatches.state,
    })
    .from(pushBatches)
    .where(sql`${pushBatches.state} in ('queued','processing')`);
  const batch = pending.find((p) =>
    p.input.items.some((i) => i.uploadId === uploadId),
  );
  return {
    state: batch
      ? 'push_pending'
      : !admitted.length
        ? 'never_pushed'
        : admitted[0].revisionId === currentRevisionId
          ? 'incorporated'
          : 'changes_not_pushed',
    revisionId: admitted[0]?.revisionId ?? null,
    commitVersion: admitted[0]?.commitVersion ?? null,
    pushId: batch?.id ?? null,
  };
}
export async function evidenceView(
  revisionId: string,
  primitiveId: string,
  knownVersion?: number,
) {
  const snapshot = await memorySnapshot({ knownVersion });
  if (!snapshot.admissions.some((a) => a.revisionId === revisionId))
    throw new Error('Evidence has not been admitted to this memory snapshot');
  const [revision] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.id, revisionId));
  const p = revision?.manifest.primitives.find((p) => p.id === primitiveId);
  if (!p) throw new Error('Evidence primitive unavailable');
  const [upload] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, revision.uploadId));
  return {
    revisionId,
    primitive: p,
    metadata: revision.manifest.metadata,
    uploadId: revision.uploadId,
    filename: upload.filename,
    rawAssetId: revision.manifest.rawAssetId,
    memoryVersion: snapshot.version,
  };
}
