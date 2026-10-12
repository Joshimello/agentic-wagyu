import { z } from 'zod';
import { id } from './index';
import type { Citation } from './research';

export const commitmentStatus = z.enum([
  'planned',
  'in_progress',
  'completion_claimed',
  'completion_verified',
  'canceled',
]);
export const reviewedValue = z
  .object({
    kind: z.enum(['decision', 'commitment']),
    stateKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,159}$/),
    text: z.string().trim().min(1).max(2400),
    status: commitmentStatus.nullable(),
    owner: z.string().trim().min(1).max(200).nullable(),
    deadline: z.string().date().nullable(),
    completionCriteria: z.string().trim().min(1).max(1200).nullable(),
  })
  .strict();
export type ReviewedValue = z.infer<typeof reviewedValue>;
const refs = z.array(z.string().regex(/^C[1-9][0-9]{0,5}$/)).max(12);
export const evidenceQuote = z
  .object({
    citationId: z.string().regex(/^C[1-9][0-9]{0,5}$/),
    quote: z.string().min(8).max(1600),
  })
  .strict();
export const changeProposal = z
  .object({
    targetItemId: id.nullable(),
    earlier: z.string().min(1).max(2400).nullable(),
    earlierCitations: refs,
    laterCitations: refs.min(1),
    evidenceQuotes: z.array(evidenceQuote).min(1).max(24),
    value: reviewedValue,
    rationale: z.string().min(1).max(1200),
    uncertainty: z.array(z.string().min(1).max(800)).max(8),
    missingInformation: z.array(z.string().min(1).max(800)).max(8),
  })
  .strict();
export const comparisonResult = z
  .object({
    proposals: z.array(changeProposal).max(30),
    warnings: z.array(z.string()).max(20),
  })
  .strict();
export type ChangeProposal = z.infer<typeof changeProposal>;
export const comparisonInput = z
  .object({
    projectId: id,
    earlierRevisionId: id,
    laterRevisionId: id,
    idempotencyKey: z.string().min(1).max(200),
  })
  .strict();
export const proposalReviewInput = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    action: z.enum(['approve', 'edit', 'reject']),
    reason: z.string().trim().min(1).max(1600),
    value: reviewedValue.optional(),
    evidenceIds: refs.min(1).optional(),
    verifyCompletion: z.boolean().default(false),
  })
  .strict();
export type ProposalReviewInput = z.infer<typeof proposalReviewInput>;
export type ApprovedVersion = {
  id: string;
  itemId: string;
  projectId: string;
  reviewVersion: number;
  eventId: string;
  previousVersionId: string | null;
  value: ReviewedValue;
  evidence: Citation[];
  reviewerAdded: string[];
  memoryVersion: number;
  createdAt: string;
};
export type ComparisonScope = {
  memoryVersion: number;
  reviewVersion: number;
  projectId: string;
  earlier: {
    revisionId: string;
    uploadId: string;
    filename: string;
    date: string | null;
  };
  later: {
    revisionId: string;
    uploadId: string;
    filename: string;
    date: string | null;
  };
  baseline: ApprovedVersion[];
  evidence: Citation[];
};
export const changesPromptVersion = 'project-changes-2-en';

export function validateProposal(
  proposal: ChangeProposal,
  scope: ComparisonScope,
) {
  const byId = new Map(scope.evidence.map((c) => [c.id, c]));
  if (proposal.value.kind === 'decision' && proposal.value.status !== null)
    throw new Error('Decisions do not have commitment status');
  if (
    proposal.value.kind === 'commitment' &&
    (!proposal.value.status || proposal.value.status === 'completion_verified')
  )
    throw new Error('Meeting reports cannot verify completion');
  if (proposal.earlier !== null && !proposal.earlierCitations.length)
    throw new Error('Earlier statement needs original evidence');
  if (proposal.earlier === null && proposal.earlierCitations.length)
    throw new Error('Earlier evidence requires an earlier statement');
  for (const ref of [...proposal.earlierCitations, ...proposal.laterCitations])
    if (
      !byId.has(ref) ||
      !proposal.evidenceQuotes.some((q) => q.citationId === ref)
    )
      throw new Error('Proposal lacks an exact quote from comparison evidence');
  for (const q of proposal.evidenceQuotes)
    if (!byId.get(q.citationId)?.quote?.includes(q.quote))
      throw new Error('Proposal quote is not present in original evidence');
  if (
    !proposal.laterCitations.some(
      (ref) => byId.get(ref)?.revisionId === scope.later.revisionId,
    )
  )
    throw new Error('Proposal needs evidence from the selected later meeting');
  if (
    proposal.earlier !== null &&
    !proposal.earlierCitations.some(
      (ref) => byId.get(ref)?.revisionId === scope.earlier.revisionId,
    )
  )
    throw new Error(
      'Comparison needs evidence from the selected earlier meeting',
    );
  if (proposal.targetItemId) {
    const target = scope.baseline.find(
      (v) => v.itemId === proposal.targetItemId,
    );
    if (
      !target ||
      target.value.kind !== proposal.value.kind ||
      target.value.stateKey !== proposal.value.stateKey
    )
      throw new Error('Proposal target differs from frozen approved state');
  } else if (
    scope.baseline.some(
      (v) =>
        v.value.kind === proposal.value.kind &&
        v.value.stateKey === proposal.value.stateKey,
    )
  ) {
    throw new Error(
      'An existing approved identity requires its frozen targetItemId',
    );
  }
}

export function proposalEvidence(
  proposal: ChangeProposal,
  scope: ComparisonScope,
  ids: string[],
) {
  return ids.map((id) => {
    const c = scope.evidence.find((c) => c.id === id);
    const q = proposal.evidenceQuotes.find((q) => q.citationId === id);
    if (!c) throw new Error('Review cites evidence outside comparison');
    if (!q) return c;
    const offset = c.quote!.indexOf(q.quote);
    if (offset < 0) throw new Error('Evidence quote is unavailable');
    const first = (c.first ?? 0) + offset,
      last = first + q.quote.length;
    return {
      ...c,
      quote: q.quote,
      first,
      last,
      url: `/evidence/${c.revisionId}/${c.primitiveId}?knownVersion=${scope.memoryVersion}&first=${first}&last=${last}`,
    };
  });
}

export function validateApproval(
  value: ReviewedValue,
  verified: boolean,
  evidence: Citation[],
) {
  if (value.kind === 'decision' && (value.status !== null || verified))
    throw new Error('Decisions cannot verify completion');
  if (value.kind === 'commitment' && value.status === null)
    throw new Error('Commitments require a status');
  if (
    value.status === 'completion_verified' &&
    (!verified || !value.completionCriteria || !evidence.length)
  )
    throw new Error(
      'Verification requires an explicit action, completion criteria, and original evidence',
    );
  if (verified && value.status !== 'completion_verified')
    throw new Error('Verification requires completion_verified status');
}
