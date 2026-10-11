import { sqlClient } from '../db/client';
import { currentOperation } from '../jobs/operation';

function limit(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid ${name}`);
  return value;
}
export function usageLimits() {
  return {
    calls: limit('LLM_MAX_CALLS_PER_OPERATION', 300),
    input: limit('LLM_MAX_INPUT_TOKENS_PER_OPERATION', 2000000),
    output: limit('LLM_MAX_OUTPUT_TOKENS_PER_OPERATION', 200000),
    daily: limit('LLM_DAILY_TOKEN_LIMIT', 0),
  };
}
export class UsageBudgetExceeded extends Error {}
/** Conservative preflight estimate, not a tokenizer. Image allowance is explicit. */
export function estimateRequest(body: Record<string, unknown>) {
  let images = 0;
  const text = JSON.stringify(body, (key, value) => {
    if (key === 'image_url') {
      images++;
      return '[image]';
    }
    return value;
  });
  return {
    input: text.length + images * 4096,
    output: Number(body.max_tokens ?? body.max_completion_tokens ?? 12000),
  };
}
export async function reserveRequest(body: Record<string, unknown>) {
  const operation = currentOperation();
  if (!operation) return null;
  operation.signal?.throwIfAborted();
  const estimated = estimateRequest(body),
    limits = usageLimits();
  if (!Number.isSafeInteger(estimated.output) || estimated.output <= 0)
    throw new Error('Invalid model output reservation');
  const id = crypto.randomUUID();
  await sqlClient.begin(async (tx) => {
    const query = tx as unknown as typeof sqlClient;
    await query`select pg_advisory_xact_lock(736508)`;
    const [used] = await query`select count(*)::int as calls,
      coalesce(sum(coalesce(input_tokens,estimated_input)),0)::float8 as input,
      coalesce(sum(coalesce(output_tokens,reserved_output)),0)::float8 as output
      from model_requests where operation_kind=${operation.kind} and operation_id=${operation.id}`;
    if (
      (limits.calls && used.calls + 1 > limits.calls) ||
      (limits.input && used.input + estimated.input > limits.input) ||
      (limits.output && used.output + estimated.output > limits.output)
    )
      throw new UsageBudgetExceeded(
        'Operation model budget exceeded; saved progress is retained',
      );
    if (limits.daily) {
      const [day] =
        await query`select coalesce(sum(coalesce(input_tokens,estimated_input)+coalesce(output_tokens,reserved_output)),0)::float8 as tokens
        from model_requests where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`;
      if (day.tokens + estimated.input + estimated.output > limits.daily)
        throw new UsageBudgetExceeded('Daily model budget exceeded');
    }
    await query`insert into model_requests(id,operation_kind,operation_id,model,request_hash,estimated_input,reserved_output)
      values(${id},${operation.kind},${operation.id},${String(body.model ?? 'unknown')},${new Bun.CryptoHasher('sha256').update(JSON.stringify(body)).digest('hex')},${estimated.input},${estimated.output})`;
  });
  return id;
}

/** Each actual HTTP attempt is reserved, including SDK retries. Unknown outcomes stay charged. */
export const meteredFetch: typeof fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const id = await reserveRequest(body),
      started = Date.now();
    const operationSignal = currentOperation()?.signal;
    try {
      const response = await fetch(input, {
        ...init,
        signal: operationSignal
          ? AbortSignal.any([
              operationSignal,
              ...(init?.signal ? [init.signal] : []),
            ])
          : init?.signal,
      });
      if (id) {
        const payload = await response
          .clone()
          .json()
          .catch(() => null);
        const usage = payload?.usage;
        const known =
          Number.isSafeInteger(usage?.prompt_tokens) &&
          usage.prompt_tokens >= 0 &&
          Number.isSafeInteger(usage?.completion_tokens) &&
          usage.completion_tokens >= 0;
        const inputPrice = process.env.LLM_INPUT_USD_PER_MILLION,
          outputPrice = process.env.LLM_OUTPUT_USD_PER_MILLION;
        const priced =
          known &&
          inputPrice !== undefined &&
          outputPrice !== undefined &&
          [Number(inputPrice), Number(outputPrice)].every(
            (v) => Number.isFinite(v) && v >= 0,
          );
        await sqlClient`update model_requests set state=${known ? 'measured' : 'unknown'}, input_tokens=${known ? usage.prompt_tokens : null}, output_tokens=${known ? usage.completion_tokens : null}, cost_usd=${priced ? ((usage.prompt_tokens * Number(inputPrice) + usage.completion_tokens * Number(outputPrice)) / 1000000).toFixed(8) : null}, elapsed_ms=${Date.now() - started} where id=${id}`;
      }
      return response;
    } catch (error) {
      if (id)
        await sqlClient`update model_requests set state='unknown', elapsed_ms=${Date.now() - started} where id=${id}`;
      throw error;
    }
  },
  { preconnect: fetch.preconnect },
);

export async function usageSummary() {
  const rows =
    await sqlClient`select operation_kind as kind, count(*)::int as calls,
    count(*) filter (where state='measured')::int as measured,
    coalesce(sum(coalesce(input_tokens,estimated_input)),0)::float8 as input,
    coalesce(sum(coalesce(output_tokens,reserved_output)),0)::float8 as output,
    case when count(cost_usd)=count(*) then sum(cost_usd::numeric)::text else null end as "costUsd"
    from model_requests where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' group by operation_kind`;
  return {
    limits: usageLimits(),
    day: new Date().toISOString().slice(0, 10),
    rows,
  };
}
