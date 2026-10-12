import { appendFile, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { id } from '../../contracts';
import { assetPath } from '../../storage';
import { MediaRequestError } from './media-client';

export function redactDiagnostic(text: string) {
  return text
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [redacted]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|authorization|secret|token)["']?\s*[:=]\s*)(["'])([\s\S]*?)\2/gi,
      '$1$2[redacted]$2',
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|authorization|secret|token)["']?\s*[:=]\s*)(?!["']|\[redacted\])[^\s"'&,}\]]+/gi,
      '$1[redacted]',
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

const failureSchema = z
  .object({
    type: z.string().max(100),
    code: z.string().max(100),
    message: z.string().max(4000),
    stack: z.string().max(12000),
    retryable: z.boolean(),
    status: z.number().int().optional(),
  })
  .strict();

export const processingEventSchema = z
  .object({
    timestamp: z.string().datetime(),
    attempt: z.number().int().nonnegative(),
    level: z.enum(['info', 'warning', 'error']),
    phase: z.string().max(500),
    message: z.string().max(2000),
    percent: z.number().int().min(0).max(100).optional(),
    failure: failureSchema.optional(),
  })
  .strict();
export type ProcessingEvent = z.infer<typeof processingEventSchema>;
export type ProcessingFailure = z.infer<typeof failureSchema>;

function cleanEvent(event: ProcessingEvent): ProcessingEvent {
  return {
    ...event,
    phase: redactDiagnostic(event.phase).slice(0, 500),
    message: redactDiagnostic(event.message).slice(0, 2000),
    ...(event.failure
      ? {
          failure: {
            ...event.failure,
            type: redactDiagnostic(event.failure.type).slice(0, 100),
            code: redactDiagnostic(event.failure.code).slice(0, 100),
            message: redactDiagnostic(event.failure.message).slice(0, 4000),
            stack: redactDiagnostic(event.failure.stack).slice(0, 12000),
          },
        }
      : {}),
  };
}

export function describeProcessingFailure(error: unknown): ProcessingFailure {
  const exception = error instanceof Error ? error : new Error(String(error));
  const media = error instanceof MediaRequestError ? error : null;
  const causes: string[] = [];
  let cause: unknown = exception;
  const visited = new Set<unknown>();
  while (cause instanceof Error && !visited.has(cause) && causes.length < 4) {
    visited.add(cause);
    causes.push(cause.stack ?? `${cause.name}: ${cause.message}`);
    cause = cause.cause;
  }
  return {
    type: exception.name.slice(0, 100),
    code:
      media?.code ??
      (exception.name === 'TimeoutError'
        ? 'request_timeout'
        : 'processing_error'),
    message: redactDiagnostic(exception.message).slice(0, 4000),
    stack: redactDiagnostic(causes.join('\nCaused by: ')).slice(0, 12000),
    retryable: media?.retryable ?? true,
    ...(media?.status === undefined ? {} : { status: media.status }),
  };
}

export async function recordProcessingEvent(
  runId: string,
  event: Omit<ProcessingEvent, 'timestamp'>,
) {
  const path = assetPath(`runs/${id.parse(runId)}/processing.jsonl`);
  const value = cleanEvent(
    processingEventSchema.parse({
      ...event,
      timestamp: new Date().toISOString(),
      phase: redactDiagnostic(event.phase).slice(0, 500),
      message: redactDiagnostic(event.message).slice(0, 2000),
    }),
  );
  try {
    await mkdir(dirname(path), { recursive: true });
    // Separate the next record from a partial append left by a process interruption.
    await appendFile(path, `\n${JSON.stringify(value)}\n`, 'utf8');
  } catch {
    console.error(
      'Processing diagnostics could not be saved; source processing continues',
    );
  }
}

export async function readProcessingEvents(
  runId: string,
): Promise<ProcessingEvent[]> {
  const path = assetPath(`runs/${id.parse(runId)}/processing.jsonl`);
  let file;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  try {
    const { size } = await file.stat();
    const length = Math.min(size, 256 * 1024),
      offset = size - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, offset);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (offset) lines.shift();
    return lines
      .filter((line) => line.trim())
      .slice(-400)
      .flatMap((line) => {
        try {
          const value = processingEventSchema.safeParse(JSON.parse(line));
          return value.success ? [cleanEvent(value.data)] : [];
        } catch {
          return [];
        }
      });
  } finally {
    await file.close();
  }
}
