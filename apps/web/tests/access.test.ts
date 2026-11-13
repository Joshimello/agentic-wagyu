import { expect, test } from 'bun:test';
import { authorize } from '../src/lib/server/access';

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
  init: { method?: string; headers?: Record<string, string> } = {},
) =>
  new Request(`http://web:5173${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'demo.example', ...init.headers },
  });
const status = (result: ReturnType<typeof authorize>) =>
  result instanceof Response ? result.status : result;
const operator = { authorization: basic('operator', 'correct horse: battery') };
const viewer = { authorization: basic('viewer', 'look-only') };

test('a workspace without configured accounts stays open', () => {
  expect(authorize(request('/api/uploads'), {})).toBe('open');
  expect(authorize(request('/api/pushes', { method: 'POST' }), {})).toBe(
    'open',
  );
});

test('every page, API, asset and export needs credentials', () => {
  for (const path of [
    '/',
    '/staging/0d0c',
    '/api/uploads',
    '/api/assets/0d0c',
    '/api/uploads/0d0c/export?format=zip',
    '/api/research/0d0c',
    '/_app/immutable/entry/start.js',
  ]) {
    const refused = authorize(request(path), env);
    expect(status(refused)).toBe(401);
    expect((refused as Response).headers.get('www-authenticate')).toContain(
      'Basic',
    );
  }
});

test('only the read-only liveness probe is exempt', () => {
  expect(authorize(request('/api/health'), env)).toBe('open');
  expect(
    status(authorize(request('/api/health', { method: 'POST' }), env)),
  ).toBe(401);
  expect(status(authorize(request('/api/health/extra'), env))).toBe(401);
});

test('wrong, partial and malformed credentials are refused', () => {
  for (const authorization of [
    basic('operator', 'wrong'),
    basic('viewer', 'correct horse: battery'),
    basic('', ''),
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

test('an incomplete account never matches and still closes the workspace', () => {
  const partial = { ACCESS_USER: 'operator' };
  expect(status(authorize(request('/'), partial))).toBe(401);
  expect(
    status(
      authorize(
        request('/', { headers: { authorization: basic('operator', '') } }),
        partial,
      ),
    ),
  ).toBe(401);
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
  // Scripts send no Origin header.
  expect(
    authorize(request('/api/pushes', { method: 'POST', headers: operator }), env),
  ).toBe('full');
});

test('the viewer can inspect but not change anything', () => {
  expect(
    authorize(request('/api/assets/0d0c', { headers: viewer }), env),
  ).toBe('viewer');
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

test('saved credentials cannot be used by another site to make changes', () => {
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
