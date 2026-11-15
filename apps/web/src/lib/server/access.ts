import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Shared-workspace access gate. Credentials come from private runtime
// configuration; when none are configured the workspace stays open, which is
// the local single-user default.
type Env = Record<string, string | undefined>;
export type AccessRole = 'open' | 'full' | 'viewer';
type SignedRole = Exclude<AccessRole, 'open'>;

const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
const sessionCookie = 'chronicler_session';
const sessionSeconds = 14 * 24 * 60 * 60;
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
export function accessEnabled(env: Env = process.env) {
  const { full, viewer } = accounts(env);
  return !!full || !!viewer;
}

function matchAccount(
  given: { user: string; password: string },
  env: Env,
): SignedRole | null {
  const { full, viewer } = accounts(env);
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
  return isFull ? 'full' : isViewer ? 'viewer' : null;
}

// Sessions are signed with a key derived from the configured accounts, so
// changing any password signs everyone out.
function sign(payload: string, env: Env) {
  const key = digest(
    [
      'chronicler-session',
      env.ACCESS_USER,
      env.ACCESS_PASSWORD,
      env.ACCESS_VIEWER_USER,
      env.ACCESS_VIEWER_PASSWORD,
    ].join('\0'),
  );
  return createHmac('sha256', key).update(payload).digest('base64url');
}
export function sessionToken(role: SignedRole, env: Env, now = Date.now()) {
  const payload = `${role}.${Math.floor(now / 1000) + sessionSeconds}`;
  return `${payload}.${sign(payload, env)}`;
}
function sessionRole(request: Request, env: Env, now = Date.now()) {
  const token = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))
    ?.slice(sessionCookie.length + 1);
  if (!token) return null;
  const [role, expires, signature, ...rest] = token.split('.');
  if (rest.length || !signature || (role !== 'full' && role !== 'viewer'))
    return null;
  if (!same(signature, sign(`${role}.${expires}`, env))) return null;
  if (!/^\d+$/.test(expires) || Number(expires) * 1000 <= now) return null;
  // A removed account cannot keep an old session.
  const account = accounts(env)[role];
  return account?.user && account.password ? role : null;
}

function basicRole(request: Request, env: Env) {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(
    request.headers.get('authorization') ?? '',
  );
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const split = decoded.indexOf(':');
  if (split < 0) return null;
  return matchAccount(
    { user: decoded.slice(0, split), password: decoded.slice(split + 1) },
    env,
  );
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

/** Only same-site paths may follow a sign-in. */
export function safeNext(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u001f]/.test(value) ||
    /^\/(login|logout)(\/|\?|$)/.test(value)
  )
    return '/';
  return value;
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function loginPage(next: string, status = 200, error = '', user = '') {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<title>Sign in | Chronicler</title>
<link rel="icon" href="/favicon.ico" sizes="32x32" /><link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<style>
:root{--canvas:#f7f6f3;--surface:#fff;--ink:#292925;--muted:#73736d;--border:#e4e3df;--accent:#2860bd;--red-soft:#fdebec;--red-ink:#9f2f2d;font-family:'Geist Variable','Noto Sans TC',system-ui,-apple-system,'Segoe UI',sans-serif;color-scheme:light}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--canvas);color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr)}
.story{position:relative;overflow:hidden;background:var(--ink);color:#f7f6f3;padding:clamp(2rem,5vw,4.5rem);display:flex;flex-direction:column;justify-content:space-between;min-height:100dvh}
.story svg.ghost{position:absolute;right:-18%;bottom:-22%;width:min(78vh,62vw);height:auto;opacity:.07;pointer-events:none}
.brand{display:flex;align-items:center;gap:.7rem;font-weight:600;font-size:1.05rem;letter-spacing:-.01em}
.brand svg{width:1.6rem;height:1.6rem;flex:none}
.story h1{font-size:clamp(1.9rem,3.6vw,3.1rem);line-height:1.12;letter-spacing:-.03em;font-weight:600;margin:0 0 1.1rem;max-width:15ch}
.story p{margin:0;max-width:34ch;color:#c9c8c2;font-size:1.02rem}
.story ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;color:#a9a8a2;font-size:.82rem}
.story li::before{content:'';display:inline-block;width:.38rem;height:.38rem;border-radius:50%;background:#5b7bae;margin-right:.55rem;vertical-align:middle}
.panel{display:flex;align-items:center;justify-content:center;padding:clamp(1.5rem,5vw,4rem);min-height:100dvh}
form{width:100%;max-width:23.5rem;animation:rise .5s cubic-bezier(.16,1,.3,1) both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
@media (prefers-reduced-motion:reduce){form{animation:none}}
h2{font-size:1.55rem;letter-spacing:-.02em;font-weight:600;margin:0 0 .35rem}
.lead{color:var(--muted);margin:0 0 1.9rem;font-size:.95rem}
label{display:block;font-size:.82rem;font-weight:500;margin:0 0 .4rem}
input{display:block;width:100%;font:inherit;color:inherit;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:.72rem .85rem;margin:0 0 1.1rem;transition:border-color .15s,box-shadow .15s}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(40,96,189,.16)}
button{width:100%;font:inherit;font-weight:500;cursor:pointer;background:var(--ink);color:#fff;border:0;border-radius:8px;padding:.8rem 1rem;margin-top:.4rem;transition:background .18s,transform .1s}
button:hover{background:#41413b}button:active{transform:scale(.99)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.error{color:var(--red-ink);background:var(--red-soft);border-radius:8px;padding:.7rem .85rem;font-size:.88rem;margin:0 0 1.2rem}
.note{color:var(--muted);font-size:.78rem;margin:1.6rem 0 0}
.mobile-brand{display:none}
@media (max-width:820px){body{grid-template-columns:1fr}.story{display:none}.mobile-brand{display:flex;margin-bottom:2.2rem}}
</style></head>
<body>
<section class="story" aria-hidden="true">
<div class="brand">${mark('#f7f6f3')}<span>Chronicler</span></div>
<div><h1>What did we decide, and why?</h1><p>Research memory that keeps decisions, their reasons and open commitments traceable to the original evidence.</p></div>
<ul><li>Inspectable sources</li><li>Cited answers</li><li>Human-reviewed changes</li></ul>
${mark('#f7f6f3', 'ghost')}
</section>
<main class="panel">
<form method="POST" action="/login">
<div class="brand mobile-brand">${mark('#292925')}<span>Chronicler</span></div>
<h2>Sign in</h2>
<p class="lead">Use the workspace account you were given.</p>
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
<input type="hidden" name="next" value="${escape(next)}" />
<label for="user">Username</label>
<input id="user" name="user" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${escape(user)}" ${user ? '' : 'autofocus'} />
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required ${user ? 'autofocus' : ''} />
<button type="submit">Sign in</button>
<p class="note">This is a shared research workspace. Access is limited to invited reviewers.</p>
</form>
</main>
</body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
function mark(ribbon: string, className = '') {
  return `<svg ${className ? `class="${className}" ` : ''}viewBox="0 0 512 512" aria-hidden="true"><path fill="${ribbon}" d="M428.7 32 L256 32 A224 224 0 0 0 256 480 L456 480 A24 24 0 0 0 480 456 L480 376 A24 24 0 0 0 456 352 L256 352 A96 96 0 0 1 256 160 L320 160 L434.3 45.7 A8 8 0 0 0 428.7 32Z"/><path fill="#5b7bae" d="M480 83.3 L480 232 A24 24 0 0 1 456 256 L362 256 A10 10 0 0 1 352 246 L352 192 L466.3 77.7 A8 8 0 0 1 480 83.3Z"/></svg>`;
}

function cookie(value: string, maxAge: number, env: Env) {
  return `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.APP_ORIGIN?.startsWith('https://') ? '; Secure' : ''}`;
}
const redirect = (location: string, setCookie?: string) =>
  new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      ...(setCookie ? { 'set-cookie': setCookie } : {}),
    },
  });

/**
 * Handles the sign-in and sign-out addresses. Returns null for every other
 * request, and for all requests when no account is configured.
 */
export async function accessRoute(
  request: Request,
  env: Env = process.env,
): Promise<Response | null> {
  if (!accessEnabled(env)) return null;
  const url = new URL(request.url);
  if (url.pathname === '/logout') {
    if (request.method !== 'POST' || crossOrigin(request, env))
      return redirect('/');
    return redirect('/login', cookie('', 0, env));
  }
  if (url.pathname !== '/login') return null;
  if (request.method === 'GET' || request.method === 'HEAD') {
    const next = safeNext(url.searchParams.get('next'));
    return sessionRole(request, env) ? redirect(next) : loginPage(next);
  }
  if (request.method !== 'POST' || crossOrigin(request, env))
    return new Response('Sign in from the workspace page.', { status: 403 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return loginPage('/', 400, 'Enter your username and password.');
  }
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const next = safeNext(text('next'));
  const user = text('user').trim().slice(0, 200);
  const role = matchAccount({ user, password: text('password') }, env);
  if (!role) {
    // Slow repeated guessing without holding the request for long.
    await new Promise((done) => setTimeout(done, 400));
    return loginPage(
      next,
      401,
      'That username and password do not match a workspace account.',
      user,
    );
  }
  return redirect(next, cookie(sessionToken(role, env), sessionSeconds, env));
}

/** Returns the caller's role, or the response that refuses the request. */
export function authorize(
  request: Request,
  env: Env = process.env,
): AccessRole | Response {
  const url = new URL(request.url);
  const safe = safeMethods.includes(request.method);
  if (!accessEnabled(env)) return 'open';
  // Container and proxy liveness probes carry no credentials.
  if (safe && url.pathname === '/api/health') return 'open';
  // Browsers sign in on the page; scripts may send Basic credentials.
  const role = sessionRole(request, env) ?? basicRole(request, env);
  if (!role) {
    const wantsPage =
      safe &&
      !url.pathname.startsWith('/api/') &&
      (request.headers.get('accept') ?? '').includes('text/html');
    if (wantsPage) return loginPage(safeNext(url.pathname + url.search), 401);
    return Response.json(
      { error: 'Sign in to open this workspace.' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }
  if (safe) return role;
  // Browsers attach the session automatically, so a change must come from
  // this site's own pages.
  if (crossOrigin(request, env))
    return Response.json(
      { error: 'Cross-site requests cannot change this workspace.' },
      { status: 403 },
    );
  // A viewer may report a mistake or tick a task: neither changes memory.
  const report =
    request.method === 'POST' && url.pathname === '/api/memory/reports';
  const tick =
    (request.method === 'POST' || request.method === 'DELETE') &&
    /^\/api\/memory\/tasks\/[0-9a-f-]+\/done$/.test(url.pathname);
  if (role === 'viewer' && !report && !tick)
    return Response.json(
      { error: 'This account can inspect the workspace but not change it.' },
      { status: 403 },
    );
  return role;
}
