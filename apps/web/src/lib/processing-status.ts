/** Observe the short failed interval while the worker queue schedules its retry. */
export function processingMayResume(
  state: string,
  updatedAt: string | Date,
  now = Date.now(),
  retryPending = false,
) {
  return (
    ['queued', 'processing'].includes(state) ||
    (state === 'failed' &&
      (retryPending || now - new Date(updatedAt).getTime() < 30000))
  );
}
