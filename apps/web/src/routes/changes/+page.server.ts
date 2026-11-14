import {
  comparisonChoices,
  listComparisons,
  approvedHistory,
  latestApproved,
  reviewHistoryVersion,
  pendingReviews,
} from '../../lib/server/services/changes';
export async function load() {
  return {
    choices: await comparisonChoices(),
    comparisons: await listComparisons(),
    pending: await pendingReviews(),
    approved: latestApproved(
      await approvedHistory(await reviewHistoryVersion()),
    ),
  };
}
