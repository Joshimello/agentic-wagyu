import { afterAll, beforeEach, expect, test } from 'bun:test';
import OpenAI from 'openai';
import {
  fallbackConfig,
  modelFetch,
  modelTimeoutMs,
  primaryAvailable,
  resetModelRouting,
} from '../src/lib/server/llm/fallback';
import { withOperation } from '../src/lib/server/jobs/operation';

type Seen = { path: string; auth: string | null; body: any };
// Stub the network so the test controls each endpoint deterministically.
const realFetch = globalThis.fetch;
const endpoints = new Map<
  string,
  { seen: Seen[]; respond: (seen: Seen, signal?: AbortSignal | null) => Promise<Response> }
>();
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const endpoint = endpoints.get(url.origin);
    if (!endpoint) throw new TypeError(`Unexpected request to ${url.origin}`);
    init?.signal?.throwIfAborted();
    const entry = {
      path: url.pathname,
      auth: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    endpoint.seen.push(entry);
    return endpoint.respond(entry, init?.signal);
  },
  { preconnect: () => {} },
) as typeof fetch;
const wait = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((done, fail) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        fail(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
function server(
  origin: string,
  respond: (seen: Seen, signal?: AbortSignal | null) => Promise<Response>,
) {
  const seen: Seen[] = [];
  endpoints.set(origin, { seen, respond });
  return { url: origin, seen };
}
const answer = (model: string) =>
  Response.json({
    id: 'x',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: '{"ok":true}' },
      },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });

let primaryStatus = 500;
let primaryDelay = 0;
const primary = server('http://primary.test', async (_, signal) => {
  if (primaryDelay) await wait(primaryDelay, signal);
  return primaryStatus === 200
    ? answer('qwen-primary')
    : Response.json({ error: { message: 'down' } }, { status: primaryStatus });
});
let fallbackRejects: string[] = [];
const fallback = server('https://cloud.test', async ({ body }) => {
  const refused = fallbackRejects.find((name) => body[name] !== undefined);
  return refused
    ? Response.json(
        { error: { message: `UnsupportedParamsError: does not support parameters: ['${refused}']` } },
        { status: 400 },
      )
    : answer(body.model);
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const env = () => ({
  OPENAI_BASE_URL: `${primary.url}/v1/`,
  OPENAI_API_KEY: 'primary-key',
  OPENAI_MODEL: 'qwen-primary',
  OPENAI_FALLBACK_BASE_URL: `${fallback.url}/api/v1`,
  OPENAI_FALLBACK_API_KEY: 'fallback-key',
  OPENAI_FALLBACK_MODEL: 'cloud-model',
  LLM_PRIMARY_TIMEOUT_MS: '400',
});
const client = (e: Record<string, string>) =>
  new OpenAI({
    apiKey: e.OPENAI_API_KEY,
    baseURL: e.OPENAI_BASE_URL,
    maxRetries: 0,
    timeout: modelTimeoutMs(e),
    fetch: modelFetch(e),
  });
const ask = (e: Record<string, string>, signal?: AbortSignal) =>
  client(e).chat.completions.create(
    {
      model: 'qwen-primary',
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'user', content: 'hi' }],
    } as any,
    { signal },
  );

// The SDK returns its own promise type, which Bun's `rejects` misreads.
const failure = (promise: Promise<unknown>) =>
  Promise.resolve(promise).then(
    () => null,
    (error: any) => ({ status: error?.status as number | undefined }),
  );

beforeEach(() => {
  resetModelRouting();
  primaryStatus = 500;
  primaryDelay = 0;
  fallbackRejects = [];
  primary.seen.length = 0;
  fallback.seen.length = 0;
});

test('without a fallback the primary result is returned unchanged', async () => {
  const { OPENAI_FALLBACK_BASE_URL, OPENAI_FALLBACK_API_KEY, OPENAI_FALLBACK_MODEL, ...only } =
    env();
  primaryStatus = 503;
  expect(await failure(ask(only))).toEqual({ status: 503 });
  expect(fallback.seen).toHaveLength(0);
  expect(modelTimeoutMs(only)).toBe(120000);
});

test('an incomplete fallback configuration is ignored', () => {
  expect(fallbackConfig({ OPENAI_FALLBACK_MODEL: 'cloud-model' })).toBeNull();
  expect(fallbackConfig({})).toBeNull();
});

test('a failing primary is answered by the fallback with a translated request', async () => {
  const result = await ask(env());
  expect(result.model).toBe('cloud-model');
  expect(primary.seen).toHaveLength(1);
  const [request] = fallback.seen;
  expect(request.path).toBe('/api/v1/chat/completions');
  expect(request.auth).toBe('Bearer fallback-key');
  expect(request.body.model).toBe('cloud-model');
  expect(request.body.chat_template_kwargs).toBeUndefined();
  expect(request.body.max_tokens).toBeUndefined();
  expect(request.body.max_completion_tokens).toBe(300);
  expect(request.body.temperature).toBe(0);
  expect(request.body.response_format).toEqual({ type: 'json_object' });
  // The primary key never reaches the fallback provider.
  expect(JSON.stringify(fallback.seen)).not.toContain('primary-key');
});

test('after a failure the primary is skipped until its cooldown ends', async () => {
  await ask(env());
  expect(primaryAvailable()).toBe(false);
  await ask(env());
  expect(primary.seen).toHaveLength(1);
  expect(fallback.seen).toHaveLength(2);
  expect(primaryAvailable(Date.now() + 121000)).toBe(true);
});

test('a slow primary times out to the fallback', async () => {
  primaryStatus = 200;
  primaryDelay = 1500;
  const result = await ask(env());
  expect(result.model).toBe('cloud-model');
});

test('rate limits and gateway errors fall back; request errors do not', async () => {
  for (const status of [429, 502, 504]) {
    resetModelRouting();
    primaryStatus = status;
    expect((await ask(env())).model).toBe('cloud-model');
  }
  resetModelRouting();
  fallback.seen.length = 0;
  primaryStatus = 400;
  expect(await failure(ask(env()))).toEqual({ status: 400 });
  expect(fallback.seen).toHaveLength(0);
  expect(primaryAvailable()).toBe(true);
});

test('a healthy primary is used and never touches the fallback', async () => {
  primaryStatus = 200;
  expect((await ask(env())).model).toBe('qwen-primary');
  expect(fallback.seen).toHaveLength(0);
});

test('structured-output schemas become JSON mode with the schema in the instructions', async () => {
  const schema = {
    type: 'object',
    properties: { questions: { type: 'array' } },
    required: ['questions'],
  };
  await client(env()).chat.completions.create({
    model: 'qwen-primary',
    messages: [
      { role: 'system', content: 'Find gaps.' },
      { role: 'user', content: 'hi' },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'plan', strict: true, schema },
    },
  } as any);
  const body = fallback.seen[0].body;
  expect(body.response_format).toEqual({ type: 'json_object' });
  expect(body.messages[0].content).toStartWith('Find gaps.');
  expect(body.messages[0].content).toContain(JSON.stringify(schema));
  expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  // The primary still receives the original structured-output request.
  expect(primary.seen[0].body.response_format.type).toBe('json_schema');
});

test('optional parameters the fallback refuses are dropped and resent once', async () => {
  fallbackRejects = ['tool_choice', 'temperature'];
  const result = await client(env()).chat.completions.create({
    model: 'qwen-primary',
    temperature: 0,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [
      {
        type: 'function',
        function: { name: 'searchMemory', parameters: { type: 'object' } },
      },
    ],
    tool_choice: 'required',
  } as any);
  expect(result.model).toBe('cloud-model');
  // One refusal per parameter, then the accepted request.
  expect(fallback.seen).toHaveLength(3);
  expect(fallback.seen[2].body.tool_choice).toBeUndefined();
  expect(fallback.seen[2].body.temperature).toBeUndefined();
  expect(fallback.seen[2].body.tools).toHaveLength(1);
});

test('other fallback request errors are returned without resending', async () => {
  fallbackRejects = ['messages'];
  expect(await failure(ask(env()))).toEqual({ status: 400 });
  expect(fallback.seen).toHaveLength(1);
});

test('temperature can be omitted for providers that reject it', async () => {
  await ask({ ...env(), OPENAI_FALLBACK_OMIT_TEMPERATURE: '1' });
  expect(fallback.seen[0].body.temperature).toBeUndefined();
});

test('cancelling an operation never escalates to the fallback', async () => {
  primaryStatus = 200;
  primaryDelay = 300;
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('canceled')), 50);
  expect(
    await failure(
      withOperation({ kind: 'test', id: 'x', signal: controller.signal }, () =>
        ask({ ...env(), LLM_PRIMARY_TIMEOUT_MS: '5000' }, controller.signal),
      ),
    ),
  ).not.toBeNull();
  expect(fallback.seen).toHaveLength(0);
});
