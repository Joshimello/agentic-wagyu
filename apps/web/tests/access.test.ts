import { expect, test } from 'bun:test';
import {
  accessRoute,
  authorize,
  safeNext,
  sessionToken,
} from '../src/lib/server/access';

const env = {
  ACCESS_USER: 'operator',
  ACCESS_PASSWORD: 'correct horse: battery',
  ACCESS_VIEWER_USER: 'viewer',
  ACCESS_VIEWER_PASSWORD: 'look-only',
  APP_ORIGIN: 'https://demo.example',
};
const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const request = (
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    form?: Record<string, string>;
  } = {},
) =>
  new Request(`http://web:5173${path}`, {
    method: init.method ?? (init.form ? 'POST' : 'GET'),
    headers: {
      host: 'demo.example',
      ...(init.form
        ? { 'content-type': 'application/x-www-form-urlencoded' }
        : {}),
      ...init.headers,
    },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
  });
const status = (result: ReturnType<typeof authorize>) =>
  result instanceof Response ? result.status : result;
const session = (role: 'full' | 'viewer', now?: number) => ({
  cookie: `other=1; chronicler_session=${sessionToken(role, env, now)}`,
});
const operator = session('full');
const viewer = session('viewer');
const browser = { accept: 'text/html,application/xhtml+xml' };

test('a workspace without configured accounts stays open', async () => {
  expect(authorize(request('/api/uploads'), {})).toBe('open');
  expect(authorize(request('/api/pushes', { method: 'POST' }), {})).toBe(
    'open',
  );
  expect(await accessRoute(request('/login'), {})).toBeNull();
});

test('every page, API, asset and export needs a sign-in', async () => {
  for (const path of [
    '/api/uploads',
    '/api/assets/0d0c',
    '/api/uploads/0d0c/export?format=zip',
    '/api/research/0d0c',
  ]) {
    const refused = authorize(request(path, { headers: browser }), env);
    expect(status(refused)).toBe(401);
    expect((refused as Response).headers.get('www-authenticate')).toBeNull();
  }
  // Pages answer a browser with the sign-in screen, remembering the address.
  const page = authorize(
    request('/staging/0d0c?tab=frames', { headers: browser }),
    env,
  ) as Response;
  expect(page.status).toBe(401);
  const html = await page.text();
  expect(html).toContain('action="/login"');
  expect(html).toContain('value="/staging/0d0c?tab=frames"');
  expect(html).not.toContain('correct horse');
});

test('only the read-only liveness probe is exempt', () => {
  expect(authorize(request('/api/health'), env)).toBe('open');
  expect(
    status(authorize(request('/api/health', { method: 'POST' }), env)),
  ).toBe(401);
  expect(status(authorize(request('/api/health/extra'), env))).toBe(401);
});

test('signing in sets a session and returns to the requested page', async () => {
  const response = (await accessRoute(
    request('/login', {
      headers: { origin: 'https://demo.example' },
      form: {
        user: ' operator ',
        password: 'correct horse: battery',
        next: '/ask',
      },
    }),
    env,
  ))!;
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/ask');
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('Secure');
  expect(cookie).not.toContain('correct horse');
  expect(
    authorize(request('/', { headers: { cookie: cookie.split(';')[0] } }), env),
  ).toBe('full');
});

test('a wrong password shows the sign-in screen again without a session', async () => {
  for (const form of [
    { user: 'operator', password: 'wrong' },
    { user: 'viewer', password: 'correct horse: battery' },
    { user: '', password: '' },
    { user: '<script>alert(1)</script>', password: 'x' },
  ]) {
    const response = (await accessRoute(
      request('/login', { headers: { origin: 'https://demo.example' }, form }),
      env,
    ))!;
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    const html = await response.text();
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('<script>alert');
  }
});

test('another site cannot submit the sign-in or sign-out forms', async () => {
  const signIn = (await accessRoute(
    request('/login', {
      headers: { origin: 'https://elsewhere.example' },
      form: { user: 'operator', password: 'correct horse: battery' },
    }),
    env,
  ))!;
  expect(signIn.status).toBe(403);
  expect(signIn.headers.get('set-cookie')).toBeNull();
  const signOut = (await accessRoute(
    request('/logout', {
      method: 'POST',
      headers: { ...operator, origin: 'https://elsewhere.example' },
    }),
    env,
  ))!;
  expect(signOut.headers.get('set-cookie')).toBeNull();
});

test('signing out clears the session', async () => {
  const response = (await accessRoute(
    request('/logout', {
      method: 'POST',
      headers: { ...viewer, origin: 'https://demo.example' },
    }),
    env,
  ))!;
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/login');
  expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
});

test('forged, expired and stale sessions are refused', () => {
  const token = sessionToken('viewer', env);
  const [, expires, signature] = token.split('.');
  const old = Date.now() - 15 * 24 * 60 * 60 * 1000;
  for (const value of [
    `full.${expires}.${signature}`,
    `viewer.${Number(expires) + 1}.${signature}`,
    `viewer.${expires}.`,
    `viewer.${expires}`,
    'full',
    sessionToken('full', env, old),
    sessionToken('full', { ...env, ACCESS_PASSWORD: 'previous password' }),
  ])
    expect(
      status(
        authorize(
          request('/api/uploads', {
            headers: { cookie: `chronicler_session=${value}` },
          }),
          env,
        ),
      ),
    ).toBe(401);
  // Removing an account ends its sessions even though the key is unchanged
  // for the other account's fields.
  expect(
    status(
      authorize(request('/api/uploads', { headers: viewer }), {
        ...env,
        ACCESS_VIEWER_PASSWORD: '',
      }),
    ),
  ).toBe(401);
});

test('an incomplete account never matches and still closes the workspace', async () => {
  const partial = { ACCESS_USER: 'operator' };
  expect(status(authorize(request('/api/uploads'), partial))).toBe(401);
  const response = (await accessRoute(
    request('/login', { form: { user: 'operator', password: '' } }),
    partial,
  ))!;
  expect(response.status).toBe(401);
});

test('the operator can read and change the workspace', () => {
  expect(authorize(request('/', { headers: operator }), env)).toBe('full');
  expect(
    authorize(
      request('/api/pushes', {
        method: 'POST',
        headers: { ...operator, origin: 'https://demo.example' },
      }),
      env,
    ),
  ).toBe('full');
});

test('scripts may send Basic credentials instead of a session', () => {
  const headers = {
    authorization: basic('operator', 'correct horse: battery'),
  };
  expect(authorize(request('/api/uploads', { headers }), env)).toBe('full');
  expect(
    authorize(request('/api/pushes', { method: 'POST', headers }), env),
  ).toBe('full');
  for (const authorization of [
    basic('operator', 'wrong'),
    basic('operator', ''),
    'Basic not-base64!',
    'Bearer correct horse: battery',
    `Basic ${Buffer.from('no-separator').toString('base64')}`,
  ])
    expect(
      status(
        authorize(request('/api/uploads', { headers: { authorization } }), env),
      ),
    ).toBe(401);
});

test('the viewer can inspect but not change anything', () => {
  expect(authorize(request('/api/assets/0d0c', { headers: viewer }), env)).toBe(
    'viewer',
  );
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT'])
    expect(
      status(
        authorize(
          request('/api/selections', {
            method,
            headers: { ...viewer, origin: 'https://demo.example' },
          }),
          env,
        ),
      ),
    ).toBe(403);
});

test('the viewer can report a mistake or tick a task and nothing else', () => {
  const post = (path: string, origin = 'https://demo.example') =>
    authorize(
      request(path, { method: 'POST', headers: { ...viewer, origin } }),
      env,
    );
  expect(post('/api/memory/reports')).toBe('viewer');
  expect(status(post('/api/memory/reports/0d0c'))).toBe(403);
  expect(status(post('/api/memory/reports', 'https://elsewhere.example'))).toBe(
    403,
  );
  const task = '/api/memory/tasks/0d0c0000-0000-4000-8000-000000000000';
  expect(post(`${task}/done`)).toBe('viewer');
  expect(
    authorize(
      request(`${task}/done`, {
        method: 'DELETE',
        headers: { ...viewer, origin: 'https://demo.example' },
      }),
      env,
    ),
  ).toBe('viewer');
  expect(status(post(task))).toBe(403);
});

test('a signed-in browser cannot be used by another site to make changes', () => {
  expect(
    status(
      authorize(
        request('/api/change-proposals/0d0c/review', {
          method: 'POST',
          headers: { ...operator, origin: 'https://elsewhere.example' },
        }),
        env,
      ),
    ),
  ).toBe(403);
  // A loopback operator session is same-site by its Host header.
  expect(
    authorize(
      request('/api/pushes', {
        method: 'POST',
        headers: {
          ...operator,
          host: '127.0.0.1:5178',
          origin: 'http://127.0.0.1:5178',
        },
      }),
      env,
    ),
  ).toBe('full');
});

test('only same-site paths may follow a sign-in', () => {
  expect(safeNext('/memory/nodes/1?x=2')).toBe('/memory/nodes/1?x=2');
  for (const value of [
    null,
    '',
    'https://elsewhere.example',
    '//elsewhere.example',
    '/\\elsewhere.example',
    '/login',
    '/logout',
    '/login?next=/',
    'ask',
  ])
    expect(safeNext(value)).toBe('/');
});
