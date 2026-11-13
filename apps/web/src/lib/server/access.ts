import { createHash, timingSafeEqual } from 'node:crypto';

// Shared-workspace access gate. Credentials come from private runtime
// configuration; when none are configured the workspace stays open, which is
// the local single-user default.
type Env = Record<string, string | undefined>;
export type AccessRole = 'open' | 'full' | 'viewer';

const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
const digest = (value: string) => createHash('sha256').update(value).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function accounts(env: Env) {
  const pair = (user?: string, password?: string) =>
    user || password ? { user: user ?? '', password: password ?? '' } : null;
  return {
    full: pair(env.ACCESS_USER, env.ACCESS_PASSWORD),
    viewer: pair(env.ACCESS_VIEWER_USER, env.ACCESS_VIEWER_PASSWORD),
  };
}

function credentials(request: Request) {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(
    request.headers.get('authorization') ?? '',
  );
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const split = decoded.indexOf(':');
  if (split < 0) return null;
  return { user: decoded.slice(0, split), password: decoded.slice(split + 1) };
}

function crossOrigin(request: Request, env: Env) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (env.APP_ORIGIN && origin === env.APP_ORIGIN) return false;
  try {
    const host =
      request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Returns the caller's role, or the response that refuses the request. */
export function authorize(
  request: Request,
  env: Env = process.env,
): AccessRole | Response {
  const { pathname } = new URL(request.url);
  const safe = safeMethods.includes(request.method);
  const { full, viewer } = accounts(env);
  if (!full && !viewer) return 'open';
  // Container and proxy liveness probes carry no credentials.
  if (safe && pathname === '/api/health') return 'open';
  const given = credentials(request);
  let role: AccessRole | null = null;
  if (given) {
    // Compare against every account so timing does not reveal which matched.
    const isFull =
      !!full?.user &&
      !!full.password &&
      same(given.user, full.user) &&
      same(given.password, full.password);
    const isViewer =
      !!viewer?.user &&
      !!viewer.password &&
      same(given.user, viewer.user) &&
      same(given.password, viewer.password);
    role = isFull ? 'full' : isViewer ? 'viewer' : null;
  }
  if (!role)
    return new Response('Sign in to open this workspace.', {
      status: 401,
      headers: {
        'www-authenticate': 'Basic realm="Chronicler", charset="UTF-8"',
        'cache-control': 'no-store',
      },
    });
  if (safe) return role;
  // Browsers attach saved credentials automatically, so a change must come
  // from this site's own pages.
  if (crossOrigin(request, env))
    return Response.json(
      { error: 'Cross-site requests cannot change this workspace.' },
      { status: 403 },
    );
  if (role === 'viewer')
    return Response.json(
      { error: 'This account can inspect the workspace but not change it.' },
      { status: 403 },
    );
  return role;
}
