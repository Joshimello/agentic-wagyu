import { organizationView } from '../lib/server/services/organization';
import {
  approvedHistory,
  comparisonChoices,
  latestApproved,
  pendingReviews,
  reviewHistoryVersion,
} from '../lib/server/services/changes';
import { listUploads } from '../lib/server/services/uploads';

export async function load() {
  const [memory, choices, history, pending, uploads] = await Promise.all([
    organizationView(),
    comparisonChoices(),
    approvedHistory(await reviewHistoryVersion()),
    pendingReviews(),
    listUploads(),
  ]);
  const approved = latestApproved(history);
  return {
    sources: uploads.length,
    projects: memory.projects.map((project) => {
      const meetings =
        choices.projects.find((p) => p.id === project.id)?.meetings ?? [];
      const mine = approved.filter((v) => v.projectId === project.id);
      return {
        id: project.id,
        title: project.current.title,
        summary: project.current.summary,
        meetings: meetings.length,
        lastMeeting:
          meetings
            .map((m) => m.date)
            .filter((d): d is string => !!d)
            .sort()
            .at(-1) ?? null,
        decisions: mine.filter((v) => v.value.kind === 'decision').length,
        commitments: mine.filter((v) => v.value.kind === 'commitment').length,
        toReview: pending
          .filter((p) => p.projectId === project.id)
          .reduce((n, p) => n + p.count, 0),
      };
    }),
  };
}
