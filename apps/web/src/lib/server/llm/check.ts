// Operator check: sends one small JSON request with an image to the primary
// model and, when configured, directly to the fallback model. Prints status
// and timing only, never credentials.
//   podman exec <project>_worker_1 bun apps/web/src/lib/server/llm/check.ts
import { fallbackConfig } from './fallback';

// 8x8 solid blue PNG.
const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPQSNiLFTEMLQkAmllRQcXBbHwAAAAASUVORK5CYII=';

async function probe(
  label: string,
  baseURL: string,
  apiKey: string,
  body: Record<string, unknown>,
) {
  const started = Date.now();
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(90000),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload: any = await response.json().catch(() => null);
    const content = payload?.choices?.[0]?.message?.content ?? '';
    let json = false;
    try {
      json = typeof JSON.parse(content) === 'object';
    } catch {}
    const ok = response.ok && json;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${label}: HTTP ${response.status}, ${Date.now() - started} ms, JSON ${json ? 'valid' : 'missing'}${
        ok ? '' : `, ${String(payload?.error?.message ?? content).replace(/\s+/g, ' ').slice(0, 160)}`
      }`,
    );
    return ok;
  } catch (error) {
    console.log(
      `FAIL ${label}: ${error instanceof Error ? error.name : 'error'} after ${Date.now() - started} ms`,
    );
    return false;
  }
}

const messages = [
  { role: 'system', content: 'Return only JSON.' },
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'What is the main color of this image? Return {"color": string}.',
      },
      { type: 'image_url', image_url: { url: image } },
    ],
  },
];
const primaryModel = process.env.OPENAI_MODEL ?? '';
const primary = await probe(
  `primary ${primaryModel}`,
  process.env.OPENAI_BASE_URL ?? '',
  process.env.OPENAI_API_KEY ?? '',
  {
    model: primaryModel,
    temperature: 0,
    max_tokens: 200,
    response_format: { type: 'json_object' },
    ...(/qwen/i.test(primaryModel)
      ? { chat_template_kwargs: { enable_thinking: false } }
      : {}),
    messages,
  },
);
const config = fallbackConfig();
let fallback = true;
if (config)
  fallback = await probe(
    `fallback ${config.model}`,
    config.baseURL,
    config.apiKey,
    {
      model: config.model,
      ...(config.omitTemperature ? {} : { temperature: 0 }),
      max_completion_tokens: 2000,
      response_format: { type: 'json_object' },
      messages,
    },
  );
else console.log('SKIP fallback: not configured');
process.exit(primary || (config && fallback) ? 0 : 1);
