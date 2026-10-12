export type ActivityTask = {
  id: string;
  kind:
    | 'upload'
    | 'interpretation'
    | 'push'
    | 'translation'
    | 'summary'
    | 'research'
    | 'comparison';
  generation: number;
  uploadId?: string;
  title: string;
  operation: string;
  state: string;
  percent: number | null;
  phase: string;
  href: string;
};
export const activeTask = (task: Pick<ActivityTask, 'state'>) =>
  ['uploading', 'queued', 'processing'].includes(task.state);
export const taskKey = (
  task: Pick<ActivityTask, 'kind' | 'id' | 'generation'>,
) => `${task.kind}:${task.id}:${task.generation}`;
