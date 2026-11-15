import { organizationView } from '../lib/server/services/organization';
import {
  approvedHistory,
  comparisonChoices,
  latestApproved,
  pendingReviews,
  reviewHistoryVersion,
} from '../lib/server/services/changes';
import { listUploads } from '../lib/server/services/uploads';
import { hiddenProjectIds } from '../lib/server/services/hidden-projects';

export async function load() {
  const [memory, choices, history, pending, uploads, hidden] = await Promise.all([
    organizationView(),
    comparisonChoices(),
    approvedHistory(await reviewHistoryVersion()),
    pendingReviews(),
    listUploads(),
    hiddenProjectIds(),
  ]);
  const approved = latestApproved(history);
  return {
    sources: uploads.length,
    removed: memory.projects
      .filter((p) => hidden.has(p.id))
      .map((p) => ({ id: p.id, title: p.current.title })),
    projects: memory.projects.filter((p) => !hidden.has(p.id)).map((project) => {
      const meetings =
        choices.projects.find((p) => p.id === project.id)?.meetings ?? [];
      const mine = approved.filter((v) => v.projectId === project.id);
      const latest = [...meetings]
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
        .at(-1);
      return {
        id: project.id,
        title: project.current.title,
        summary: project.current.summary,
        meetings: meetings.length,
        // The newest meeting that has a captured frame supplies the picture.
        picture:
          [...meetings]
            .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
            .find((m) => m.frameAssetId)?.frameAssetId ?? null,
        thumbnail:
          uploads.find(
            (u) =>
              u.id === latest?.uploadId &&
              /\.(mp4|mov|mkv|webm|m4v)$/i.test(u.filename),
          )?.assetId ?? null,
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
