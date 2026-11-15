import {
  comparisonChoices,
  pendingReviews,
} from '../../../lib/server/services/changes';
import { hiddenProjectIds } from '../../../lib/server/services/hidden-projects';
import { memoryMap } from '../../../lib/server/services/memory-map';

export async function load({ url }: { url: URL }) {
  const [choices, hidden, pending] = await Promise.all([
    comparisonChoices(),
    hiddenProjectIds(),
    pendingReviews(),
  ]);
  const projects = choices.projects
    .filter((p) => !hidden.has(p.id))
    .map((p) => ({
      id: p.id,
      title: p.title,
      meetings: p.meetings.length,
      picture:
        [...p.meetings]
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
          .find((m) => m.frameAssetId)?.frameAssetId ?? null,
      toReview: pending
        .filter((r) => r.projectId === p.id)
        .reduce((n, r) => n + r.count, 0),
    }));
  const wanted = url.searchParams.get('project');
  const chosen = projects.find((p) => p.id === wanted) ?? projects[0];
  return {
    projects,
    map: chosen ? await memoryMap(chosen.id).catch(() => null) : null,
  };
}
