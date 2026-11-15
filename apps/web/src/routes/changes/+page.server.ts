import {
  comparisonChoices,
  listComparisons,
  approvedHistory,
  latestApproved,
  reviewHistoryVersion,
  pendingReviews,
} from '../../lib/server/services/changes';
import { hiddenProjectIds } from '../../lib/server/services/hidden-projects';
export async function load({ url }: { url: URL }) {
  const [choices, hidden] = await Promise.all([
    comparisonChoices(),
    hiddenProjectIds(),
  ]);
  return {
    choices: {
      ...choices,
      projects: choices.projects.filter((p) => !hidden.has(p.id)),
    },
    comparisons: await listComparisons(),
    pending: await pendingReviews(),
    preferred: url.searchParams.get('project'),
    approved: latestApproved(
      await approvedHistory(await reviewHistoryVersion()),
    ),
  };
}
