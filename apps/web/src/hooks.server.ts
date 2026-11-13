import type { Handle } from '@sveltejs/kit/hooks';
import { sqlClient } from './lib/server/db/client';
import { accessRoute, authorize } from './lib/server/access';
process.once('sveltekit:shutdown', async () => {
  await sqlClient.end({ timeout: 5 });
});
export const handle: Handle = async ({ event, resolve }) => {
  const signIn = await accessRoute(event.request);
  if (signIn) return signIn;
  const access = authorize(event.request);
  if (access instanceof Response) return access;
  event.locals.access = access;
  if (
    process.env.READ_ONLY_MODE === '1' &&
    !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)
  )
    return Response.json(
      {
        error:
          'This restored workspace is open for inspection. Resume its workers and writable web service before making changes.',
      },
      { status: 403 },
    );
  return resolve(event);
};
