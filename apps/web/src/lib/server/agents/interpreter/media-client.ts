import { config } from '../../config';

export class MediaRequestError extends Error {
  constructor(
    message: string,
    readonly route: string,
    readonly code: 'media_timeout' | 'media_unavailable' | 'media_response',
    readonly retryable: boolean,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MediaRequestError';
  }
}

export async function mediaRequest(
  route: string,
  body: unknown,
  signal?: AbortSignal,
) {
  const timeoutMs =
    route === 'transcribe'
      ? config.mediaTranscriptionTimeoutMs
      : route === 'document'
        ? 1800000
        : 960000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const response = await fetch(`${config.mediaUrl}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: requestSignal,
      // Bun's default idle timeout ends a quiet inference request after five minutes.
      // The explicit deadline and job cancellation govern long local model calls.
      timeout: false,
    });
    const result = await response.json();
    if (!response.ok) {
      const detail = result.detail;
      let cause: Error | undefined;
      if (
        detail &&
        typeof detail === 'object' &&
        typeof detail.failure?.message === 'string'
      ) {
        cause = new Error(detail.failure.message);
        cause.name =
          typeof detail.failure.type === 'string'
            ? detail.failure.type
            : 'MediaServiceError';
        cause.stack =
          typeof detail.failure.stack === 'string'
            ? detail.failure.stack
            : undefined;
      }
      throw new MediaRequestError(
        typeof detail === 'string'
          ? detail
          : typeof detail?.message === 'string'
            ? `${detail.message}${cause ? `: ${cause.name}: ${cause.message}` : ''}`
            : `Media ${route} failed (HTTP ${response.status})`,
        route,
        'media_response',
        response.status >= 500 || [408, 409, 429].includes(response.status),
        response.status,
        cause ? { cause } : undefined,
      );
    }
    return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof MediaRequestError) throw error;
    if (deadline.aborted)
      throw new MediaRequestError(
        `Media ${route} exceeded its ${Math.round(timeoutMs / 60000)}-minute request limit. Completed work is retained.`,
        route,
        'media_timeout',
        true,
        undefined,
        { cause: error },
      );
    throw new MediaRequestError(
      `Media ${route} request failed: ${error instanceof Error ? error.message : 'service unavailable'}`,
      route,
      'media_unavailable',
      true,
      undefined,
      { cause: error },
    );
  }
}
