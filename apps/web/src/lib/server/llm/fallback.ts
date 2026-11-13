import { currentOperation } from '../jobs/operation';
import { meteredRequest } from './usage';

// Optional second model used when the primary gateway cannot answer. Both are
// OpenAI-compatible Chat Completions endpoints. Each attempt is metered under
// the model that actually received it, so the usage ledger shows which model
// answered every request.
type Env = Record<string, string | undefined>;
export type FallbackConfig = {
  model: string;
  baseURL: string;
  apiKey: string;
  primaryTimeoutMs: number;
  fallbackTimeoutMs: number;
  cooldownMs: number;
  omitTemperature: boolean;
};

const trim = (value?: string) => value?.trim().replace(/\/+$/, '') ?? '';
function milliseconds(env: Env, name: string, fallback: number) {
  const value = Number(env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
let warnedIncomplete = false;
export function fallbackConfig(env: Env = process.env): FallbackConfig | null {
  const model = env.OPENAI_FALLBACK_MODEL?.trim() ?? '',
    baseURL = trim(env.OPENAI_FALLBACK_BASE_URL),
    apiKey = env.OPENAI_FALLBACK_API_KEY?.trim() ?? '';
  if (!model && !baseURL && !apiKey) return null;
  if (!model || !baseURL || !apiKey) {
    if (!warnedIncomplete)
      console.error(
        'Model fallback disabled: set OPENAI_FALLBACK_MODEL, OPENAI_FALLBACK_BASE_URL and OPENAI_FALLBACK_API_KEY together',
      );
    warnedIncomplete = true;
    return null;
  }
  return {
    model,
    baseURL,
    apiKey,
    primaryTimeoutMs: milliseconds(env, 'LLM_PRIMARY_TIMEOUT_MS', 120000),
    fallbackTimeoutMs: milliseconds(env, 'LLM_FALLBACK_TIMEOUT_MS', 180000),
    cooldownMs: milliseconds(env, 'LLM_FALLBACK_COOLDOWN_MS', 120000),
    omitTemperature: env.OPENAI_FALLBACK_OMIT_TEMPERATURE === '1',
  };
}

// After a primary failure, send requests straight to the fallback for a short
// cooldown instead of waiting for the primary to fail again on every call.
const circuit = { primaryClosedUntil: 0 };
export function resetModelRouting() {
  circuit.primaryClosedUntil = 0;
  warnedIncomplete = false;
}
export function primaryAvailable(now = Date.now()) {
  return now >= circuit.primaryClosedUntil;
}

/** Parameters a request still works without, if a provider refuses them. */
const optionalParameters = ['tool_choice', 'temperature'];

/** Failures that another model can reasonably recover from. */
const recoverable = (status: number) =>
  status === 408 || status === 429 || status >= 500;

function fallbackRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  config: FallbackConfig,
  primaryBase: string,
): [string, RequestInit] {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (!primaryBase || !url.startsWith(primaryBase))
    throw new Error('Model request does not target the configured gateway');
  const body =
    typeof init?.body === 'string' ? JSON.parse(init.body) : ({} as any);
  body.model = config.model;
  // Primary-only options: Qwen's template switch and the legacy token field.
  delete body.chat_template_kwargs;
  if (body.max_tokens !== undefined && body.max_completion_tokens === undefined)
    body.max_completion_tokens = body.max_tokens;
  delete body.max_tokens;
  if (config.omitTemperature) delete body.temperature;
  // Not every provider or gateway route enforces structured-output schemas
  // (some return prose). Plain JSON mode plus the schema in the instructions
  // works everywhere; callers validate the result with their own schema.
  if (body.response_format?.type === 'json_schema') {
    const schema = body.response_format.json_schema?.schema;
    body.response_format = { type: 'json_object' };
    const instruction = `Return only a JSON object that matches this JSON Schema exactly: ${JSON.stringify(schema ?? {})}`;
    const messages: any[] = Array.isArray(body.messages) ? body.messages : [];
    const system = messages.find((m) => m?.role === 'system');
    if (!system) messages.unshift({ role: 'system', content: instruction });
    else if (typeof system.content === 'string')
      system.content = `${system.content}\n\n${instruction}`;
    else if (Array.isArray(system.content))
      system.content.push({ type: 'text', text: instruction });
    body.messages = messages;
  }
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${config.apiKey}`);
  headers.delete('content-length');
  return [
    config.baseURL + url.slice(primaryBase.length),
    { ...init, headers, body: JSON.stringify(body) },
  ];
}

const withTimeout = (signal: AbortSignal | null | undefined, ms: number) => {
  const timeout = AbortSignal.timeout(ms);
  return { timeout, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
};

/** Fetch used by the model client: primary first, fallback when it fails. */
export function modelFetch(env: Env = process.env): typeof fetch {
  const routed = async (input: RequestInfo | URL, init?: RequestInit) => {
    const config = fallbackConfig(env);
    if (!config) return meteredRequest(input, init);
    const external = init?.signal;
    const cancelled = () =>
      !!external?.aborted || !!currentOperation()?.signal?.aborted;
    if (primaryAvailable()) {
      let sent = false,
        reason = '';
      const attempt = withTimeout(external, config.primaryTimeoutMs);
      try {
        const response = await meteredRequest(
          input,
          { ...init, signal: attempt.signal },
          () => (sent = true),
        );
        if (!recoverable(response.status)) {
          circuit.primaryClosedUntil = 0;
          return response;
        }
        reason = `HTTP ${response.status}`;
        await response.body?.cancel().catch(() => {});
      } catch (error) {
        // Budget refusals, cancellations and the caller's own deadline are
        // not outages; another model must not bypass them.
        if (!sent || cancelled()) throw error;
        reason = attempt.timeout.aborted ? 'timeout' : 'connection failed';
      }
      circuit.primaryClosedUntil = Date.now() + config.cooldownMs;
      console.warn('Primary model unavailable; using fallback model', {
        reason,
        fallbackModel: config.model,
        retryPrimaryAfterSeconds: Math.round(config.cooldownMs / 1000),
      });
    }
    const [url, request] = fallbackRequest(
      input,
      init,
      config,
      trim(env.OPENAI_BASE_URL),
    );
    const attempt = withTimeout(external, config.fallbackTimeoutMs);
    let response = await meteredRequest(url, {
      ...request,
      signal: attempt.signal,
    });
    // Some providers reject optional parameters outright, naming one per
    // refusal. Resend without each named one; any other 400 is returned.
    const body = JSON.parse(String(request.body));
    for (let tries = 0; tries < optionalParameters.length; tries++) {
      if (response.status !== 400) break;
      const message = await response
        .clone()
        .text()
        .catch(() => '');
      const unsupported = optionalParameters.filter(
        (name) => body[name] !== undefined && message.includes(name),
      );
      if (!unsupported.length) break;
      await response.body?.cancel().catch(() => {});
      for (const name of unsupported) delete body[name];
      console.warn('Fallback model rejected optional parameters; resending', {
        parameters: unsupported,
      });
      response = await meteredRequest(url, {
        ...request,
        body: JSON.stringify(body),
        signal: attempt.signal,
      });
    }
    return response;
  };
  return Object.assign(routed, { preconnect: fetch.preconnect });
}

/** The client deadline must leave room for one primary and one fallback attempt. */
export function modelTimeoutMs(env: Env = process.env) {
  const config = fallbackConfig(env);
  return config ? config.primaryTimeoutMs + config.fallbackTimeoutMs : 120000;
}
