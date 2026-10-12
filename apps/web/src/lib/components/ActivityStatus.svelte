<script lang="ts">
  import { onMount } from 'svelte';
  import { useActivity } from '../ui/activity.svelte';
  import { activeTask, taskKey, type ActivityTask } from '../activity';
  import { popover } from '../ui/motion';
  import Icon from './Icon.svelte';
  import ProgressBar from './ProgressBar.svelte';
  const activity = useActivity();
  let ready = $state(false);
  let container = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let active = $derived(activity.tasks.filter(activeTask).length);
  let visible = $derived([
    ...activity.tasks.filter(activeTask),
    ...activity.tasks.filter((task) => !activeTask(task)).slice(0, 8),
  ]);
  onMount(() => {
    ready = true;
    return activity.start();
  });
  function close() {
    activity.opened = false;
    trigger?.focus({ preventScroll: true });
  }
  function outside(event: PointerEvent) {
    if (activity.opened && !container?.contains(event.target as Node))
      activity.opened = false;
  }
  function stateLabel(task: ActivityTask) {
    if (activity.canceling.includes(taskKey(task))) return 'Stopping';
    if (task.state === 'queued') return 'Queued';
    if (activeTask(task)) return 'Running';
    if (task.state === 'canceled') return 'Canceled';
    if (task.state === 'failed') return 'Failed';
    return 'Done';
  }
  const icons = {
    upload: 'upload',
    interpretation: 'video',
    push: 'folder',
    translation: 'translate',
    summary: 'file',
    research: 'help',
    comparison: 'refresh',
  };
</script>

<svelte:window
  onpointerdown={outside}
  onkeydown={(event) => {
    if (event.key === 'Escape' && activity.opened) {
      event.preventDefault();
      close();
    }
  }}
/>
<div class="activity-status" bind:this={container}>
  <button
    class="secondary status-trigger"
    class:running={active > 0}
    bind:this={trigger}
    disabled={!ready}
    aria-label={`Processing status${active ? `, ${active} active ${active === 1 ? 'task' : 'tasks'}` : ''}`}
    aria-expanded={activity.opened}
    aria-haspopup="dialog"
    title="Processing status"
    onclick={() => (activity.opened = !activity.opened)}
  >
    <Icon name="clock" size={19} /><span class="status-label">Status</span
    >{#if active}<span class="activity-count">{active}</span>{/if}
  </button>
  {#if activity.opened}<div
      class="activity-panel"
      role="dialog"
      aria-label="Processing status"
      transition:popover
    >
      <header>
        <h2>Activity</h2>
        <button
          class="secondary icon-button"
          aria-label="Close processing status"
          onclick={close}><Icon name="close" /></button
        >
      </header>
      {#if activity.error}<p class="error" role="alert">
          {activity.error}
        </p>{/if}
      {#if !visible.length}<div class="empty-activity">
          <Icon name="success" size={24} /><span>No active tasks</span>
        </div>{/if}
      <div class="activity-list">
        {#each visible as task (taskKey(task))}<article
            class:finished={!activeTask(task)}
          >
            <div class="task-heading">
              <span class="task-icon"><Icon name={icons[task.kind]} /></span>
              <a
                class="task-title"
                href={task.href}
                onclick={() => (activity.opened = false)}
                title={task.title}>{task.title}</a
              >
              {#if activeTask(task)}<button
                  class="secondary icon-button task-cancel"
                  disabled={activity.canceling.includes(taskKey(task))}
                  aria-label={`Cancel ${task.operation.toLowerCase()} for ${task.title}`}
                  title="Cancel this task"
                  onclick={() => activity.cancel(task)}
                  ><Icon name="close" size={16} /></button
                >
              {:else}<button
                  class="secondary icon-button task-dismiss"
                  aria-label={`Dismiss ${task.operation.toLowerCase()} for ${task.title}`}
                  title="Dismiss"
                  onclick={() => activity.dismiss(task)}
                  ><Icon name="close" size={16} /></button
                >{/if}
            </div>
            <div class="task-meta">
              <span>{task.operation}</span><span
                class:failed={task.state === 'failed'}>{stateLabel(task)}</span
              >
            </div>
            {#if activeTask(task)}<ProgressBar
                compact
                value={task.percent}
                label={task.phase}
                ariaLabel={`${task.operation} progress for ${task.title}`}
                state={task.state === 'uploading' ? 'processing' : task.state}
              />{/if}
          </article>{/each}
      </div>
    </div>{/if}
</div>

<style>
  .activity-status {
    position: relative;
    flex: none;
  }
  .status-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 0.65rem;
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .status-trigger.running {
    color: var(--accent);
    background: var(--blue-soft);
  }
  .activity-count {
    display: grid;
    place-items: center;
    min-width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    color: white;
    background: var(--accent);
    font-size: 0.65rem;
  }
  .activity-panel {
    position: absolute;
    right: 0;
    top: calc(100% + 0.65rem);
    width: min(23rem, calc(100vw - 2rem));
    max-height: min(35rem, 76dvh);
    display: flex;
    flex-direction: column;
    z-index: 80;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    padding: 0.9rem;
    box-shadow: 0 12px 35px rgb(0 0 0 / 0.09);
    transform-origin: top right;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  h2 {
    font-size: 0.94rem;
    margin: 0;
  }
  .activity-list {
    overflow-y: auto;
    min-height: 0;
    overscroll-behavior: contain;
  }
  article {
    padding: 0.75rem 0.2rem;
    border-top: 1px solid var(--border);
  }
  .task-heading {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .task-icon {
    color: var(--accent);
    display: inline-flex;
  }
  .task-title {
    font-size: 0.8rem;
    font-weight: 550;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-meta {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    color: var(--muted);
    font-size: 0.69rem;
    margin: 0.35rem 0 0.5rem;
  }
  .task-meta .failed {
    color: var(--red-ink);
  }
  .finished .task-meta {
    margin-bottom: 0;
  }
  .task-cancel,
  .task-dismiss {
    min-width: 1.6rem;
    min-height: 1.6rem;
    padding: 0.2rem;
  }
  .task-dismiss {
    opacity: 0.7;
  }
  .empty-activity {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 1.5rem 0.5rem;
    color: var(--muted);
    font-size: 0.82rem;
  }
  .empty-activity :global(.ui-icon) {
    color: var(--accent);
  }
  .error {
    font-size: 0.75rem;
    margin: 0.3rem 0 0.7rem;
  }
  @media (max-width: 800px) {
    .status-label {
      display: none;
    }
  }
</style>
