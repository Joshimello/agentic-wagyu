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
    return meteredRequest(url, { ...request, signal: attempt.signal });
  };
  return Object.assign(routed, { preconnect: fetch.preconnect });
}

/** The client deadline must leave room for one primary and one fallback attempt. */
export function modelTimeoutMs(env: Env = process.env) {
  const config = fallbackConfig(env);
  return config ? config.primaryTimeoutMs + config.fallbackTimeoutMs : 120000;
}
