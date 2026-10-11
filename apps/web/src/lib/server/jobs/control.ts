export class JobCanceled extends Error {
  constructor() {
    super('Processing canceled');
    this.name = 'JobCanceled';
  }
}

/** Database state is authoritative across web and worker processes. */
export function watchJob(
  active: () => Promise<boolean>,
  externalSignal?: AbortSignal,
) {
  const controller = new AbortController();
  let checking: Promise<void> | undefined;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  if (externalSignal?.aborted) forwardAbort();
  async function assertActive() {
    controller.signal.throwIfAborted();
    checking ??= (async () => {
      if (!(await active())) controller.abort(new JobCanceled());
    })().finally(() => {
      checking = undefined;
    });
    await checking;
    controller.signal.throwIfAborted();
  }
  const timer = setInterval(() => {
    void assertActive().catch((error) => {
      if (!controller.signal.aborted) controller.abort(error);
    });
  }, 500);
  return {
    signal: controller.signal,
    assertActive,
    stop() {
      clearInterval(timer);
      externalSignal?.removeEventListener('abort', forwardAbort);
    },
  };
}

export type JobProgress = (message: string, percent?: number) => Promise<void>;

export function boundedProgress(value: number) {
  return Math.max(0, Math.min(99, Math.floor(value)));
}
