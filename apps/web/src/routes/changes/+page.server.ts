import {
  comparisonChoices,
  listComparisons,
  approvedHistory,
  latestApproved,
  reviewHistoryVersion,
} from '../../lib/server/services/changes';
export async function load() {
  return {
    choices: await comparisonChoices(),
    comparisons: await listComparisons(),
    approved: latestApproved(
      await approvedHistory(await reviewHistoryVersion()),
    ),
  };
}
