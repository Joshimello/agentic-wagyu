import { eq } from 'drizzle-orm';
import { id } from '../../../../lib/server/contracts';
import { db } from '../../../../lib/server/db/client';
import {
  approvedItemVersions,
  changeProposals,
  changeReviewEvents,
} from '../../../../lib/server/db/schema';
import {
  getComparison,
  approvedHistory,
} from '../../../../lib/server/services/changes';
export async function load({ params }: { params: { id: string } }) {
  const [event] = await db
    .select()
    .from(changeReviewEvents)
    .where(eq(changeReviewEvents.id, id.parse(params.id)));
  if (!event) throw new Error('Review event not found');
  const [proposal] = await db
    .select()
    .from(changeProposals)
    .where(eq(changeProposals.id, event.proposalId));
  const { job } = await getComparison(proposal.comparisonId);
  const [approved] = await db
    .select()
    .from(approvedItemVersions)
    .where(eq(approvedItemVersions.eventId, event.id));
  const history = approved
    ? (await approvedHistory(event.reviewVersion, job.scope.projectId)).filter(
        (v) => v.itemId === approved.itemId,
      )
    : [];
  return { event, proposal, job, approved: approved ?? null, history };
}
