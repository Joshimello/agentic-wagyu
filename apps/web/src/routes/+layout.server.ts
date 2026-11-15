import type { AccessRole } from '../lib/server/access';
import { organizationView } from '../lib/server/services/organization';
import { hiddenProjectIds } from '../lib/server/services/hidden-projects';

export async function load({ locals }: { locals: { access?: AccessRole } }) {
  // The Ask panel lists projects on every page; it must not break a page.
  const projects = await Promise.all([organizationView(), hiddenProjectIds()])
    .then(([view, hidden]) =>
      view.projects
        .filter((p) => !hidden.has(p.id))
        .map((p) => ({ id: p.id, title: p.current.title })),
    )
    .catch(() => []);
  return {
    readOnly: process.env.READ_ONLY_MODE === '1',
    access: locals.access ?? 'open',
    projects,
  };
}
