import {
  organizationView,
  searchOrganization,
} from '../../lib/server/services/organization';
import { memoryOptions } from '../../lib/server/services/memory';
import { listPushes } from '../../lib/server/services/pushes';
export async function load({ url }: { url: URL }) {
  const options = memoryOptions(url);
  return {
    memory: await organizationView(options),
    search: url.searchParams.get('q')
      ? await searchOrganization(url.searchParams.get('q')!, options)
      : null,
    pushes: await listPushes(),
  };
}
