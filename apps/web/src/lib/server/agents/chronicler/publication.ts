import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  pushBatches,
  pushItems,
  revisions,
  memoryCommits,
  memoryProjects,
  memoryEntities,
  statements,
  statementVersions,
  statementRelations,
  evidenceAdmissions,
  knowledgeEvents,
  memoryNodes,
  memoryNodeVersions,
  uploads,
} from '../../db/schema';
import { validateStage, type Stage } from '../../contracts';
import {
  assertionSchema,
  validateEvidence,
  hasSupportedDate,
  stableId,
  type Plan,
} from '../../contracts/memory';
import { validateOrganization } from './organization/validation';
export class StaleMemory extends Error {}
/** Publication is the only memory writer. All evidence admissions, identities and history are one transaction. */
export async function publishMemory(
  pushId: string,
  plan: Plan,
  generation?: number,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(736501)`);
    await tx.execute(sql`select pg_advisory_xact_lock(736502)`);
    const [batch] = await tx
      .select()
      .from(pushBatches)
      .where(eq(pushBatches.id, pushId))
      .for('update');
    if (!batch) throw new Error('Push not found');
    if (
      batch.state === 'committed' ||
      batch.state === 'canceled' ||
      (generation !== undefined && batch.generation !== generation)
    )
      return batch;
    const [latest] = await tx
      .select({
        version: sql<number>`coalesce(max(${memoryCommits.version}),0)::int`,
      })
      .from(memoryCommits);
    const selected = await tx
      .select()
      .from(pushItems)
      .where(eq(pushItems.pushId, pushId));
    for (const item of selected) {
      const [upload] = await tx
        .select()
        .from(uploads)
        .where(eq(uploads.id, item.uploadId));
      if (!upload || upload.deletedAt)
        throw new Error('Selected source was removed from staging');
    }
    const admitted = await tx.select().from(evidenceAdmissions);
    const fresh = selected.filter(
      (item) => !admitted.some((a) => a.revisionId === item.revisionId),
    );
    const existingNodes = await tx.select().from(memoryNodes);
    const existingNodeVersions = await tx.select().from(memoryNodeVersions);
    const hasOrganization = Boolean(plan.organization?.versions.length);
    if (batch.input.workflow === 'summary' && !plan.organization)
      throw new Error('Summary push requires organization plan');
    if (
      batch.input.workflow === 'summary' &&
      !hasOrganization &&
      selected.some(
        (i) =>
          !existingNodes.some(
            (n) => n.kind === 'source' && n.revisionId === i.revisionId,
          ),
      )
    )
      throw new Error('Selected source has not been organized');
    if (!fresh.length && !hasOrganization) {
      const outcomes = selected.map((i) => ({
        uploadId: i.uploadId,
        revisionId: i.revisionId,
        disposition: 'duplicate' as const,
        assertions: 0,
        warnings: [],
      }));
      const [done] = await tx
        .update(pushBatches)
        .set({
          state: 'committed',
          progressPercent: 100,
          commitVersion: latest.version,
          outcomes,
          progress: 'Already incorporated; memory unchanged',
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(pushBatches.id, pushId))
        .returning();
      return done;
    }
    if (plan.baseVersion !== latest.version)
      throw new StaleMemory(
        'Committed memory changed; reconciliation must be refreshed',
      );
    const stages: Stage[] = [];
    for (const item of selected) {
      const [revision] = await tx
        .select()
        .from(revisions)
        .where(eq(revisions.id, item.revisionId));
      if (!revision || revision.uploadId !== item.uploadId)
        throw new Error('Pinned revision missing');
      const stage = validateStage(revision.manifest);
      if (!stage.coverage.complete && !item.acceptPartial)
        throw new Error('Partial evidence not accepted');
      stages.push(stage);
    }
    const allowed = new Set(
      (plan.organization ? selected : fresh).map((i) => i.revisionId),
    );
    if (plan.organization) {
      if (
        plan.entities.length ||
        plan.statements.length ||
        plan.versions.length ||
        plan.relations.length
      )
        throw new Error('Summary push cannot publish typed assertions');
      const active = new Map<string, string>();
      for (const a of [...admitted].sort(
        (a, b) => a.commitVersion - b.commitVersion,
      ))
        active.set(a.uploadId, a.revisionId);
      for (const i of fresh) active.set(i.uploadId, i.revisionId);
      for (const i of selected)
        if (active.get(i.uploadId) !== i.revisionId)
          throw new Error('Cannot organize obsolete source revision');
      validateOrganization(
        plan.organization,
        existingNodes,
        existingNodeVersions.map((v) => ({
          ...v.payload,
          commitVersion: v.commitVersion,
        })),
        stages,
        new Set(active.values()),
      );
    }
    const existingProjects = await tx.select().from(memoryProjects),
      existingEntities = await tx.select().from(memoryEntities),
      existingStatements = await tx.select().from(statements),
      existingVersions = await tx.select().from(statementVersions);
    const allProjects = [...existingProjects, ...plan.projects],
      allEntities = [...existingEntities, ...plan.entities],
      allStatements = [...existingStatements, ...plan.statements],
      allVersions = [...existingVersions, ...plan.versions];
    for (const [label, records] of [
      ['projects', plan.projects],
      ['entities', plan.entities],
      ['statements', plan.statements],
      ['versions', plan.versions],
      ['relations', plan.relations],
    ] as const)
      if (new Set(records.map((r) => r.id)).size !== records.length)
        throw new Error(`Duplicate ${label} identity`);
    if (
      plan.outcomes.length !== selected.length ||
      new Set(plan.outcomes.map((o) => o.revisionId)).size !==
        selected.length ||
      plan.outcomes.some(
        (o) =>
          !selected.some(
            (i) => i.uploadId === o.uploadId && i.revisionId === o.revisionId,
          ),
      )
    )
      throw new Error('Missing per-file push outcome');
    for (const p of plan.projects) {
      if (existingProjects.some((e) => e.id === p.id))
        throw new Error('Cannot overwrite a project identity');
      validateEvidence(p.evidence, stages, allowed);
    }
    for (const e of plan.entities) {
      if (
        existingEntities.some((old) => old.id === e.id) ||
        !allProjects.some((p) => p.id === e.projectId)
      )
        throw new Error('Invalid entity/project identity');
      validateEvidence(e.evidence, stages, allowed);
    }
    for (const s of plan.statements) {
      if (
        existingStatements.some((old) => old.id === s.id) ||
        !allProjects.some((p) => p.id === s.projectId)
      )
        throw new Error('Invalid assertion/project identity');
    }
    for (const v of plan.versions) {
      const s = allStatements.find((s) => s.id === v.statementId);
      if (!s || existingVersions.some((old) => old.id === v.id))
        throw new Error('Cannot overwrite accepted assertion history');
      assertionSchema.parse({
        ref: v.id,
        projectRef: s.projectId,
        entityRefs: v.entityIds,
        text: v.text,
        stateKey: s.stateKey,
        type: s.type,
        arguments: v.arguments,
        evidenceRefs: v.evidence.map((e) => e.primitiveId),
        effectiveDate: v.effectiveDate,
        updateBasisQuote: v.updateBasisQuote,
      });
      validateEvidence(v.evidence, stages, allowed);
      if (
        v.effectiveDate &&
        !hasSupportedDate(v.effectiveDate, stages, v.evidence)
      )
        throw new Error('Effective date lacks source support');
      if (
        'dueDate' in v.arguments &&
        v.arguments.dueDate &&
        !hasSupportedDate(v.arguments.dueDate, stages, v.evidence, false)
      )
        throw new Error('Deadline lacks source support');
      if (
        v.entityIds.some(
          (id) =>
            !allEntities.some(
              (e) => e.id === id && e.projectId === s.projectId,
            ),
        )
      )
        throw new Error('Assertion entity belongs to another project');
      if (
        v.updateBasisQuote &&
        !v.evidence.some((e) => {
          const p = stages
            .find((s) => s.id === e.revisionId)
            ?.primitives.find((p) => p.id === e.primitiveId);
          return p?.kind === 'text' && p.text.includes(v.updateBasisQuote!);
        })
      )
        throw new Error('Update quotation lacks exact source support');
    }
    for (const r of plan.relations) {
      const a = allVersions.find((v) => v.id === r.fromVersionId),
        b = allVersions.find((v) => v.id === r.toVersionId);
      const left = allStatements.find((s) => s.id === a?.statementId),
        right = allStatements.find((s) => s.id === b?.statementId);
      if (
        !a ||
        !b ||
        !left ||
        !right ||
        left.projectId !== right.projectId ||
        left.type !== right.type ||
        a.id === b.id ||
        ![...plan.versions].some((v) => v.id === a.id || v.id === b.id) ||
        !['support', 'supersede', 'conflict'].includes(r.kind)
      )
        throw new Error('Invalid cross-scope memory relation');
      if (
        r.kind === 'supersede' &&
        (!a.updateBasisQuote ||
          !a.effectiveDate ||
          !b.effectiveDate ||
          a.effectiveDate < b.effectiveDate ||
          a.statementId !== b.statementId)
      )
        throw new Error(
          'Replacement lacks explicit dated update to the same state',
        );
      if (
        r.kind === 'supersede' &&
        ![
          'ProjectGoal',
          'Decision',
          'Commitment',
          'ProblemReport',
          'OpenQuestion',
        ].includes(left.type)
      )
        throw new Error(
          'Cannot automatically replace a nonexclusive research finding',
        );
      if (r.kind === 'support' && a.statementId !== b.statementId)
        throw new Error('Support must reuse assertion identity');
    }
    const version = latest.version + 1;
    await tx.insert(memoryCommits).values({
      id: stableId(pushId, 'commit'),
      pushId,
      version,
      createdAt: sql`clock_timestamp()`,
    });
    if (plan.projects.length)
      await tx
        .insert(memoryProjects)
        .values(plan.projects.map((p) => ({ ...p, createdVersion: version })));
    if (plan.entities.length)
      await tx
        .insert(memoryEntities)
        .values(plan.entities.map((e) => ({ ...e, createdVersion: version })));
    if (plan.statements.length)
      await tx
        .insert(statements)
        .values(
          plan.statements.map((s) => ({ ...s, createdVersion: version })),
        );
    if (plan.versions.length)
      await tx
        .insert(statementVersions)
        .values(plan.versions.map((v) => ({ ...v, commitVersion: version })));
    if (plan.relations.length)
      await tx
        .insert(statementRelations)
        .values(plan.relations.map((r) => ({ ...r, commitVersion: version })));
    if (plan.organization?.nodes.length)
      await tx.insert(memoryNodes).values(
        plan.organization.nodes.map((n) => ({
          ...n,
          createdVersion: version,
        })),
      );
    if (plan.organization?.versions.length) {
      await tx.insert(memoryNodeVersions).values(
        plan.organization.versions.map((v) => ({
          id: v.id,
          nodeId: v.nodeId,
          commitVersion: version,
          payload: v,
        })),
      );
      for (const v of plan.organization.versions)
        await tx.insert(knowledgeEvents).values({
          id: stableId(pushId, 'summary', v.id),
          commitVersion: version,
          kind: 'summary_node_recorded',
          payload: {
            nodeId: v.nodeId,
            versionId: v.id,
            model: v.model,
            promptVersion: v.promptVersion,
          },
        });
    }
    for (const item of fresh) {
      const stage = stages.find((s) => s.id === item.revisionId)!;
      await tx.insert(evidenceAdmissions).values({
        revisionId: item.revisionId,
        uploadId: item.uploadId,
        commitVersion: version,
        sourceTime: stage.metadata.sourceTime,
      });
      const previous = admitted.filter((a) => a.uploadId === item.uploadId);
      await tx.insert(knowledgeEvents).values({
        id: stableId(pushId, 'source', item.revisionId),
        commitVersion: version,
        kind: previous.length ? 'source_revision_replaced' : 'source_admitted',
        payload: {
          uploadId: item.uploadId,
          revisionId: item.revisionId,
          previousRevisionIds: previous.map((a) => a.revisionId),
        },
      });
    }
    for (const v of plan.versions)
      await tx.insert(knowledgeEvents).values({
        id: stableId(pushId, 'assertion', v.id),
        commitVersion: version,
        kind: 'assertion_recorded',
        payload: {
          statementId: v.statementId,
          versionId: v.id,
          model: v.model,
          promptVersion: v.promptVersion,
        },
      });
    for (const r of plan.relations)
      await tx.insert(knowledgeEvents).values({
        id: stableId(pushId, 'relationEvent', r.id),
        commitVersion: version,
        kind: r.kind,
        payload: { ...r },
      });
    const [done] = await tx
      .update(pushBatches)
      .set({
        state: 'committed',
        progressPercent: 100,
        commitVersion: version,
        outcomes: plan.outcomes,
        plan,
        progress: `Committed memory version ${version}`,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(pushBatches.id, pushId))
      .returning();
    return done;
  });
}
