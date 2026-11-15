import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import {
  approvedItemVersions,
  changeProposals,
  changeReviewEvents,
  comparisonJobs,
  memoryReports,
  taskCompletions,
} from '../db/schema';
import { id } from '../contracts';
import type { ComparisonScope } from '../contracts/changes';
import type { Citation } from '../contracts/research';
import { organizationSnapshot } from './organization';
import { loadResearchCorpus } from './research';

const clip = (text: string, max = 320) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
const support = (c: Citation, quote?: string) => ({
  url: c.url,
  filename: c.filename,
  quote: clip(quote ?? c.quote ?? ''),
});

/**
 * One project's memory laid out by meeting: what each meeting discussed, the
 * reviewed decisions and tasks it produced, and what still waits for review.
 */
export async function memoryMap(projectId: string) {
  const snapshot = await organizationSnapshot();
  const corpus = await loadResearchCorpus(
    { version: snapshot.version, projectId },
    false,
  );
  const project = corpus.view.projects.find((p) => p.id === projectId);
  if (!project) throw new Error('Project not found');

  const topics = new Map<string, { id: string; title: string }[]>();
  for (const n of corpus.view.segments) {
    if (!corpus.active.has(n.id) || !n.revisionId) continue;
    const list = topics.get(n.revisionId) ?? [];
    if (!n.current.segment?.contextOnly)
      list.push({ id: n.id, title: n.current.title });
    topics.set(n.revisionId, list);
  }
  const meetings = [...topics].flatMap(([revisionId, list]) => {
    const row = corpus.data.stages.get(revisionId);
    if (!row) return [];
    const meta = row.stage.metadata;
    return [
      {
        revisionId,
        uploadId: row.stage.uploadId,
        name: meta.label || row.filename,
        date: meta.sourceTimeOrigin === 'user' ? meta.sourceTime : null,
        frameAssetId:
          row.stage.primitives.find((p) => p.kind === 'image')?.assetId ?? null,
        topics: list,
      },
    ];
  });
  meetings.sort(
    (a, b) =>
      (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const meetingOf = (scope: ComparisonScope['later']) =>
    meetings.find((m) => m.uploadId === scope.uploadId)?.revisionId ?? null;

  const approved = await db
    .select({
      version: approvedItemVersions,
      later: sql<ComparisonScope['later']>`${comparisonJobs.scope}->'later'`,
      action: sql<string>`${changeReviewEvents.input}->>'action'`,
      was: sql<string | null>`${changeProposals.proposal}->>'earlier'`,
    })
    .from(approvedItemVersions)
    .innerJoin(
      changeReviewEvents,
      eq(changeReviewEvents.id, approvedItemVersions.eventId),
    )
    .innerJoin(
      changeProposals,
      eq(changeProposals.id, changeReviewEvents.proposalId),
    )
    .innerJoin(comparisonJobs, eq(comparisonJobs.id, changeProposals.comparisonId))
    .where(eq(approvedItemVersions.projectId, projectId))
    .orderBy(asc(approvedItemVersions.reviewVersion));
  const latest = new Map(approved.map((r) => [r.version.itemId, r.version.id]));
  const done = new Set(
    (
      await db
        .select({ itemId: taskCompletions.itemId })
        .from(taskCompletions)
        .where(eq(taskCompletions.projectId, projectId))
    ).map((r) => r.itemId),
  );
  const items = approved.map((r) => ({
    done: done.has(r.version.itemId),
    id: r.version.id,
    itemId: r.version.itemId,
    eventId: r.version.eventId,
    state:
      latest.get(r.version.itemId) === r.version.id
        ? ('accepted' as const)
        : ('replaced' as const),
    previousId: r.version.previousVersionId,
    edited: r.action === 'edit',
    was: r.was,
    value: r.version.value,
    meeting: meetingOf(r.later),
    createdAt: r.version.createdAt.toISOString(),
    evidence: r.version.evidence.slice(0, 4).map((c) => support(c)),
  }));

  const waiting = await db
    .select({
      id: changeProposals.id,
      comparisonId: changeProposals.comparisonId,
      proposal: changeProposals.proposal,
      scope: comparisonJobs.scope,
    })
    .from(changeProposals)
    .innerJoin(comparisonJobs, eq(comparisonJobs.id, changeProposals.comparisonId))
    .where(
      and(
        sql`${comparisonJobs.input}->>'projectId' = ${projectId}`,
        eq(comparisonJobs.state, 'completed'),
        sql`not exists (select 1 from ${changeReviewEvents} where ${changeReviewEvents.proposalId}=${changeProposals.id})`,
      ),
    )
    .orderBy(asc(changeProposals.createdAt));
  const pending = waiting.map((r) => ({
    id: r.id,
    comparisonId: r.comparisonId,
    was: r.proposal.earlier,
    value: r.proposal.value,
    why: r.proposal.rationale,
    meeting: meetingOf(r.scope.later),
    evidence: r.proposal.laterCitations.slice(0, 4).flatMap((ref) => {
      const c = r.scope.evidence.find((c) => c.id === ref);
      return c
        ? [
            support(
              c,
              r.proposal.evidenceQuotes.find((q) => q.citationId === ref)?.quote,
            ),
          ]
        : [];
    }),
  }));

  return {
    project: { id: project.id, title: project.current.title },
    meetings,
    items,
    pending,
    reports: await openReports(projectId),
  };
}

/** Ticks or unticks a reviewed task as completed. The reviewed text stays as it is. */
export async function setTaskDone(value: unknown, isDone: boolean) {
  const itemId = id.parse(value);
  if (!isDone) {
    await db.delete(taskCompletions).where(eq(taskCompletions.itemId, itemId));
    return;
  }
  const [row] = await db
    .select({ projectId: approvedItemVersions.projectId })
    .from(approvedItemVersions)
    .where(eq(approvedItemVersions.itemId, itemId))
    .limit(1);
  if (!row) throw new Error('Task not found');
  await db
    .insert(taskCompletions)
    .values({ itemId, projectId: row.projectId })
    .onConflictDoNothing();
}

const reportInput = z
  .object({
    projectId: id,
    targetId: id,
    targetText: z.string().trim().min(1).max(2400),
    note: z.string().trim().min(1).max(1600),
    reporter: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict();

/** A reader's note that something in memory looks wrong. It changes no memory. */
export async function reportMistake(value: unknown) {
  const input = reportInput.parse(value);
  const [row] = await db
    .insert(memoryReports)
    .values({ id: crypto.randomUUID(), ...input })
    .returning();
  return row;
}
export async function resolveReport(value: unknown) {
  await db
    .update(memoryReports)
    .set({ resolvedAt: new Date() })
    .where(eq(memoryReports.id, id.parse(value)));
}
async function openReports(projectId: string) {
  const rows = await db
    .select()
    .from(memoryReports)
    .where(
      and(eq(memoryReports.projectId, projectId), isNull(memoryReports.resolvedAt)),
    )
    .orderBy(desc(memoryReports.createdAt));
  return rows.map((r) => ({
    id: r.id,
    targetId: r.targetId,
    targetText: r.targetText,
    note: r.note,
    reporter: r.reporter,
    createdAt: r.createdAt.toISOString(),
  }));
}
