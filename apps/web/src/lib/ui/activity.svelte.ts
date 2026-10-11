import { getContext } from 'svelte';
import { activeTask, taskKey, type ActivityTask } from '../activity';
export const activityContext = Symbol('workspace-activity');
export type ActivityState = ReturnType<typeof createActivity>;
export const useActivity = () => getContext<ActivityState>(activityContext);

export function createActivity() {
  let server = $state<ActivityTask[]>([]);
  let local = $state<ActivityTask[]>([]);
  let dismissed = $state<string[]>([]);
  let opened = $state(false);
  let loadError = $state('');
  let actionError = $state('');
  let canceling = $state<string[]>([]);
  const aborters = new Map<string, () => void>();
  let pending: Promise<void> | undefined;
  let epoch = 0;
  let disposed = false;
  let tasks = $derived(
    [
      ...local,
      ...server.filter(
        (task) =>
          !local.some((item) => item.id === task.id && item.kind === task.kind),
      ),
    ].filter((task) => activeTask(task) || !dismissed.includes(taskKey(task))),
  );
  async function refresh(force = false): Promise<void> {
    if (disposed) return;
    if (pending) {
      await pending;
      if (force && !disposed) return refresh();
      return;
    }
    const version = epoch;
    const operation = (async () => {
      try {
        const response = await fetch('/api/activity');
        if (!response.ok) throw new Error();
        const rows: ActivityTask[] = await response.json();
        if (!disposed && version === epoch) {
          server = rows;
          loadError = '';
        }
      } catch {
        if (!disposed && version === epoch)
          loadError = 'Status is temporarily unavailable.';
      }
    })();
    pending = operation;
    try {
      await operation;
    } finally {
      if (pending === operation) pending = undefined;
    }
  }
  async function cancel(task: ActivityTask) {
    const key = taskKey(task);
    if (!activeTask(task) || canceling.includes(key)) return;
    canceling = [...canceling, key];
    ++epoch;
    actionError = '';
    if (task.kind === 'upload') aborters.get(task.id)?.();
    const endpoint =
      task.kind === 'research'
        ? `/api/research/${task.id}`
        : task.kind === 'push'
          ? `/api/pushes/${task.id}/cancel`
          : task.kind === 'upload'
            ? `/api/upload-sessions/${task.id}/cancel`
            : `/api/uploads/${task.uploadId}/${task.kind === 'interpretation' ? 'cancel' : task.kind === 'translation' ? 'translations/cancel' : 'summary/cancel'}`;
    const body =
      task.kind === 'research'
        ? { action: 'cancel', generation: task.generation }
        : task.kind === 'interpretation'
          ? { runId: task.id }
          : task.kind === 'translation'
            ? { translationId: task.id }
            : task.kind === 'summary'
              ? { summaryId: task.id, generation: task.generation }
              : undefined;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        ...(body
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
      });
      if (!response.ok) throw new Error('Could not stop this task. Try again.');
      ++epoch;
      if (task.kind === 'upload')
        local = local.map((item) =>
          item.id === task.id
            ? { ...item, state: 'canceled', phase: 'Canceled' }
            : item,
        );
      await refresh(true);
    } catch (e) {
      actionError =
        e instanceof Error ? e.message : 'Could not cancel this task';
    } finally {
      canceling = canceling.filter((item) => item !== key);
    }
  }
  return {
    get tasks() {
      return tasks;
    },
    get error() {
      return actionError || loadError;
    },
    get opened() {
      return opened;
    },
    set opened(value: boolean) {
      opened = value;
    },
    get canceling() {
      return canceling;
    },
    refresh,
    cancel,
    dismiss(task: ActivityTask) {
      if (activeTask(task)) return;
      dismissed = [...new Set([...dismissed, taskKey(task)])].slice(-200);
      localStorage.setItem(
        'chronicler-dismissed-tasks',
        JSON.stringify(dismissed),
      );
      local = local.filter((item) => taskKey(item) !== taskKey(task));
    },
    reveal() {
      opened = true;
      void refresh();
    },
    beginUpload(id: string, filenames: string[], abort: () => void) {
      aborters.set(id, abort);
      local = [
        ...local,
        {
          id,
          kind: 'upload',
          generation: 0,
          title: `${filenames[0]}${filenames.length > 1 ? ` + ${filenames.length - 1}` : ''}`,
          operation: 'Upload',
          state: 'uploading',
          percent: 0,
          phase: 'Sending source files',
          href: '/',
        },
      ];
    },
    uploadProgress(id: string, percent: number | null) {
      local = local.map((item) =>
        item.id === id
          ? {
              ...item,
              percent: percent === null ? null : Math.min(99, percent),
              phase:
                percent === 100
                  ? 'Saving source files'
                  : 'Sending source files',
            }
          : item,
      );
    },
    finishUpload(id: string, state: 'accepted' | 'failed' | 'canceled') {
      aborters.delete(id);
      local =
        state === 'accepted'
          ? local.filter((item) => item.id !== id)
          : local.map((item) =>
              item.id === id
                ? {
                    ...item,
                    state:
                      state === 'canceled' && canceling.includes(taskKey(item))
                        ? 'uploading'
                        : state,
                    phase: state === 'failed' ? 'Upload failed' : 'Stopping',
                  }
                : item,
            );
      void refresh();
    },
    start() {
      disposed = false;
      try {
        const saved = JSON.parse(
          localStorage.getItem('chronicler-dismissed-tasks') || '[]',
        );
        if (Array.isArray(saved))
          dismissed = saved
            .filter((key) => typeof key === 'string')
            .slice(-200);
      } catch {}
      void refresh();
      const timer = setInterval(() => {
        if (!document.hidden || local.some(activeTask)) void refresh();
      }, 1500);
      return () => {
        disposed = true;
        clearInterval(timer);
      };
    },
  };
}
