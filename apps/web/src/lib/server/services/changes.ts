import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  approvedItemVersions,
  changeProposals,
  changeReviewEvents,
  comparisonJobs,
  comparisonOutbox,
} from '../db/schema';
import {
  comparisonInput,
  proposalReviewInput,
  proposalEvidence,
  validateApproval,
  validateProposal,
  type ApprovedVersion,
  type ComparisonScope,
} from '../contracts/changes';
import type { Citation } from '../contracts/research';
import { organizationSnapshot } from './organization';
import { loadResearchCorpus } from './research';
import { segmentContent } from '../agents/chronicler/organization/source';

type Reader = Pick<typeof db, 'select'>;
export async function reviewHistoryVersion(
  cutoff?: string,
  reader: Reader = db,
) {
  const [row] = await reader
    .select({
      version: sql<number>`coalesce(max(${changeReviewEvents.reviewVersion}),0)::int`,
    })
    .from(changeReviewEvents)
    .where(
      cutoff ? lte(changeReviewEvents.createdAt, new Date(cutoff)) : undefined,
    );
  return row.version;
}
export async function approvedHistory(
  version: number,
  projectId?: string,
  reader: Reader = db,
  knownAt?: string,
): Promise<ApprovedVersion[]> {
  const rows = await reader
    .select()
    .from(approvedItemVersions)
    .where(
      and(
        lte(approvedItemVersions.reviewVersion, version),
        projectId ? eq(approvedItemVersions.projectId, projectId) : undefined,
        knownAt
          ? sql`exists (select 1 from ${changeReviewEvents} where ${changeReviewEvents.id}=${approvedItemVersions.eventId} and ${changeReviewEvents.createdAt} <= ${knownAt}::timestamptz)`
          : undefined,
      ),
    )
    .orderBy(asc(approvedItemVersions.reviewVersion));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
export function latestApproved(history: ApprovedVersion[]) {
  return [...new Map(history.map((v) => [v.itemId, v])).values()];
}
export async function comparisonChoices() {
  const snapshot = await organizationSnapshot();
  const corpus = await loadResearchCorpus({ version: snapshot.version }, false);
  const projects = [];
  for (const project of corpus.view.projects) {
    const scoped = await loadResearchCorpus(
      { version: snapshot.version, projectId: project.id },
      false,
    );
    const revisionIds = [
      ...new Set(
        scoped.view.segments
          .filter((n) => scoped.active.has(n.id))
          .flatMap((n) => (n.revisionId ? [n.revisionId] : [])),
      ),
    ];
    const meetings = revisionIds.flatMap((revisionId) => {
      const row = scoped.data.stages.get(revisionId);
      if (
        !row ||
        !row.stage.primitives.some(
          (p) => p.kind === 'text' && p.locator.kind === 'media',
        )
      )
        return [];
      return [
        {
          revisionId,
          uploadId: row.stage.uploadId,
          filename: row.filename,
          label: row.stage.metadata.label,
          date: row.stage.metadata.sourceTimeOrigin === 'user' ? row.stage.metadata.sourceTime : null,
        },
      ];
    });
    projects.push({ id: project.id, title: project.current.title, meetings });
  }
  return { memoryVersion: snapshot.version, projects };
}

export async function createComparison(value: unknown) {
  const input = comparisonInput.parse(value);
  return db.transaction(async (tx) => {
    // Memory publication and reviewer/Ask capture use this same lock order.
    await tx.execute(sql`select pg_advisory_xact_lock(736502)`);
    await tx.execute(sql`select pg_advisory_xact_lock(736503)`);
    const [existing] = await tx
      .select()
      .from(comparisonJobs)
      .where(eq(comparisonJobs.idempotencyKey, input.idempotencyKey));
    if (existing) {
      if (
        JSON.stringify(comparisonInput.parse(existing.input)) !==
        JSON.stringify(input)
      )
        throw new Error('Idempotency key belongs to a different comparison');
      return existing;
    }
    if (input.earlierRevisionId === input.laterRevisionId)
      throw new Error('Choose two different admitted meetings');
    const snapshot = await organizationSnapshot();
    const corpus = await loadResearchCorpus(
      { version: snapshot.version, projectId: input.projectId },
      false,
    );
    const meeting = (revisionId: string) => {
      const source = corpus.data.stages.get(revisionId);
      if (
        !source ||
        !corpus.view.segments.some(
          (n) => corpus.active.has(n.id) && n.revisionId === revisionId,
        ) ||
        !source.stage.primitives.some(
          (p) => p.kind === 'text' && p.locator.kind === 'media',
        )
      )
        throw new Error(
          'Meeting is not active admitted evidence for the selected project',
        );
      return {
        revisionId,
        uploadId: source.stage.uploadId,
        filename: source.filename,
        date: source.stage.metadata.sourceTimeOrigin === 'user' ? source.stage.metadata.sourceTime : null,
      };
    };
    const earlier = meeting(input.earlierRevisionId),
      later = meeting(input.laterRevisionId);
    if (earlier.uploadId === later.uploadId)
      throw new Error(
        'Choose two different meetings, not revisions of the same upload',
      );
    const reviewVersion = await reviewHistoryVersion(undefined, tx);
    const baseline = latestApproved(
      await approvedHistory(reviewVersion, input.projectId, tx),
    );
    const evidence: Citation[] = [];
    const keys = new Set<string>();
    for (const n of corpus.view.segments.filter(
      (n) =>
        corpus.active.has(n.id) &&
        [earlier.revisionId, later.revisionId].includes(n.revisionId!),
    )) {
      const range = n.current.segment!;
      const row = corpus.data.stages.get(range.revisionId)!;
      for (const t of segmentContent(row.stage, range.firstUnit, range.lastUnit)
        .texts) {
        const key = `${row.stage.id}:${t.primitiveId}:${t.first}:${t.last}`;
        if (keys.has(key)) continue;
        keys.add(key);
        evidence.push({
          id: `C${evidence.length + 1}`,
          revisionId: row.stage.id,
          primitiveId: t.primitiveId,
          nodeId: n.id,
          nodeVersionId: n.current.id,
          filename: row.filename,
          kind: 'text',
          locator: t.locator,
          quote: t.text,
          first: t.first,
          last: t.last,
          historical: false,
          url: `/evidence/${row.stage.id}/${t.primitiveId}?knownVersion=${snapshot.version}&first=${t.first}&last=${t.last}`,
        });
      }
    }
    // Include baseline support only when it belongs to this frozen project.
    for (const version of baseline)
      for (const c of version.evidence) {
        if (!corpus.allowed.has(c.nodeId))
          throw new Error(
            'Approved baseline evidence is outside this project snapshot',
          );
        const key = `${c.revisionId}:${c.primitiveId}:${c.first}:${c.last}`;
        if (!keys.has(key)) {
          keys.add(key);
          evidence.push({ ...c, id: `C${evidence.length + 1}` });
        }
      }
    if (
      !evidence.some((c) => c.revisionId === earlier.revisionId) ||
      !evidence.some((c) => c.revisionId === later.revisionId)
    )
      throw new Error('Both meetings need original project text');
    if (evidence.reduce((n, c) => n + (c.quote?.length ?? 0), 0) > 240000)
      throw new Error(
        'Selected project evidence exceeds comparison budget; choose shorter meetings',
      );
    const scope: ComparisonScope = {
      memoryVersion: snapshot.version,
      reviewVersion,
      projectId: input.projectId,
      earlier,
      later,
      baseline,
      evidence,
    };
    const [job] = await tx
      .insert(comparisonJobs)
      .values({
        id: crypto.randomUUID(),
        idempotencyKey: input.idempotencyKey,
        input,
        scope,
      })
      .returning();
    await tx.insert(comparisonOutbox).values({ id: job.id });
    return job;
  });
}
export async function getComparison(id: string) {
  const [job] = await db
    .select()
    .from(comparisonJobs)
    .where(eq(comparisonJobs.id, id));
  if (!job) throw new Error('Comparison not found');
  const proposals = await db
    .select()
    .from(changeProposals)
    .where(eq(changeProposals.comparisonId, id))
    .orderBy(asc(changeProposals.createdAt));
  const events = proposals.length
    ? await db
        .select()
        .from(changeReviewEvents)
        .where(
          inArray(
            changeReviewEvents.proposalId,
            proposals.map((p) => p.id),
          ),
        )
    : [];
  return {
    job,
    proposals: proposals.map((p) => ({
      ...p,
      review: events.find((e) => e.proposalId === p.id) ?? null,
    })),
  };
}
export async function listComparisons() {
  return db
    .select({
      id: comparisonJobs.id,
      input: comparisonJobs.input,
      state: comparisonJobs.state,
      createdAt: comparisonJobs.createdAt,
    })
    .from(comparisonJobs)
    .orderBy(desc(comparisonJobs.createdAt))
    .limit(50);
}
export async function changeComparison(
  id: string,
  action: 'cancel' | 'retry',
  generation: number,
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(comparisonJobs)
      .where(eq(comparisonJobs.id, id))
      .for('update');
    if (!job || job.generation !== generation)
      throw new Error('Comparison changed; refresh before acting');
    if (action === 'cancel') {
      if (!['queued', 'processing', 'failed'].includes(job.state)) return job;
      const [canceled] = await tx
        .update(comparisonJobs)
        .set({ state: 'canceled', progress: 'Canceled', updatedAt: new Date() })
        .where(eq(comparisonJobs.id, id))
        .returning();
      return canceled;
    }
    if (!['failed', 'canceled'].includes(job.state))
      throw new Error('Only failed or canceled comparisons can be retried');
    const [retried] = await tx
      .update(comparisonJobs)
      .set({
        state: 'queued',
        generation: job.generation + 1,
        error: null,
        progress: 'Waiting to compare the same snapshot',
        updatedAt: new Date(),
      })
      .where(eq(comparisonJobs.id, id))
      .returning();
    await tx
      .update(comparisonOutbox)
      .set({ dispatchedAt: null, generation: retried.generation })
      .where(eq(comparisonOutbox.id, id));
    return retried;
  });
}

export async function reviewChange(proposalId: string, value: unknown) {
  const input = proposalReviewInput.parse(value);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(736502)`);
    await tx.execute(sql`select pg_advisory_xact_lock(736503)`);
    const [existing] = await tx
      .select()
      .from(changeReviewEvents)
      .where(eq(changeReviewEvents.idempotencyKey, input.idempotencyKey));
    if (existing) {
      if (
        existing.proposalId !== proposalId ||
        JSON.stringify(proposalReviewInput.parse(existing.input)) !==
          JSON.stringify(input)
      )
        throw new Error('Review idempotency key belongs to a different action');
      return existing;
    }
    const [p] = await tx
      .select()
      .from(changeProposals)
      .where(eq(changeProposals.id, proposalId));
    if (!p) throw new Error('Proposal not found');
    const [job] = await tx
      .select()
      .from(comparisonJobs)
      .where(eq(comparisonJobs.id, p.comparisonId));
    if (job.state !== 'completed')
      throw new Error('Comparison must finish before review');
    const [reviewed] = await tx
      .select()
      .from(changeReviewEvents)
      .where(eq(changeReviewEvents.proposalId, proposalId));
    if (reviewed) throw new Error('Proposal has already been reviewed');
    let finalValue = p.proposal.value,
      evidence: Citation[] = [],
      previous: ApprovedVersion | undefined;
    if (input.action !== 'reject') {
      validateProposal(p.proposal, job.scope);
      if (
        input.action === 'approve' &&
        (input.value || input.evidenceIds || input.verifyCompletion)
      )
        throw new Error(
          'Use edit and approve to change proposal values or verify completion',
        );
      if (input.action === 'edit' && !input.value)
        throw new Error('Edited values are required');
      finalValue = input.value ?? p.proposal.value;
      if (
        finalValue.kind !== p.proposal.value.kind ||
        finalValue.stateKey !== p.proposal.value.stateKey
      )
        throw new Error('Review cannot change proposal identity');
      const ids = input.evidenceIds ?? [
        ...new Set([
          ...p.proposal.earlierCitations,
          ...p.proposal.laterCitations,
        ]),
      ];
      evidence = proposalEvidence(p.proposal, job.scope, ids);
      if (!evidence.some((c) => c.revisionId === job.scope.later.revisionId))
        throw new Error('Keep original evidence from the later meeting');
      validateApproval(finalValue, input.verifyCompletion, evidence);
      const snapshot = await organizationSnapshot();
      const currentCorpus = await loadResearchCorpus(
        { version: snapshot.version, projectId: job.scope.projectId },
        false,
      );
      for (const selected of [job.scope.earlier, job.scope.later])
        if (
          !currentCorpus.view.segments.some(
            (n) =>
              currentCorpus.active.has(n.id) &&
              n.revisionId === selected.revisionId,
          )
        )
          throw new Error(
            'Selected evidence has been superseded or removed from the accepted project; create a fresh comparison',
          );
      const latest = new Map(
        snapshot.admissions
          .slice()
          .sort((a, b) => a.commitVersion - b.commitVersion)
          .map((a) => [a.uploadId, a.revisionId]),
      );
      const revisionIds = [
        ...new Set([
          job.scope.earlier.revisionId,
          job.scope.later.revisionId,
          ...evidence.map((c) => c.revisionId),
        ]),
      ];
      for (const revisionId of revisionIds) {
        const admission = snapshot.admissions.find(
          (a) => a.revisionId === revisionId,
        );
        if (!admission || latest.get(admission.uploadId) !== revisionId)
          throw new Error(
            'Selected evidence has been superseded by a later admission; create a fresh comparison',
          );
      }
      const current = latestApproved(
        await approvedHistory(
          await reviewHistoryVersion(undefined, tx),
          job.scope.projectId,
          tx,
        ),
      );
      previous = p.proposal.targetItemId
        ? current.find((v) => v.itemId === p.proposal.targetItemId)
        : current.find(
            (v) =>
              v.value.stateKey === finalValue.stateKey &&
              v.value.kind === finalValue.kind,
          );
      const baseline = p.proposal.targetItemId
        ? job.scope.baseline.find((v) => v.itemId === p.proposal.targetItemId)
        : undefined;
      if (
        (p.proposal.targetItemId &&
          (!previous || previous.id !== baseline?.id)) ||
        (!p.proposal.targetItemId && previous)
      )
        throw new Error(
          'Approved target state changed; create a fresh comparison',
        );
    } else if (input.value || input.evidenceIds || input.verifyCompletion)
      throw new Error('Rejection cannot publish edited values');
    const reviewVersion = (await reviewHistoryVersion(undefined, tx)) + 1;
    const [event] = await tx
      .insert(changeReviewEvents)
      .values({
        id: crypto.randomUUID(),
        proposalId,
        idempotencyKey: input.idempotencyKey,
        reviewVersion,
        input,
        createdAt: sql`clock_timestamp()`,
      })
      .returning();
    if (input.action !== 'reject') {
      const reviewerAdded = Object.keys(finalValue).filter(
        (key) =>
          JSON.stringify(finalValue[key as keyof typeof finalValue]) !==
            JSON.stringify(p.proposal.value[key as keyof typeof finalValue]) ||
          (previous?.reviewerAdded.includes(key) &&
            JSON.stringify(finalValue[key as keyof typeof finalValue]) ===
              JSON.stringify(previous.value[key as keyof typeof finalValue])),
      );
      await tx.insert(approvedItemVersions).values({
        id: crypto.randomUUID(),
        itemId: previous?.itemId ?? crypto.randomUUID(),
        projectId: job.scope.projectId,
        reviewVersion,
        eventId: event.id,
        previousVersionId: previous?.id ?? null,
        value: finalValue,
        evidence,
        reviewerAdded,
        memoryVersion: job.scope.memoryVersion,
        createdAt: event.createdAt,
      });
    }
    return event;
  });
}
