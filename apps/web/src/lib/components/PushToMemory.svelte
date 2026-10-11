<script lang="ts">
  import { tick } from 'svelte';
  import { useActivity } from '../ui/activity.svelte';
  import type { Stage } from '../server/contracts';
  import Icon from './Icon.svelte';
  import Disclosure from './Disclosure.svelte';
  import Select from './Select.svelte';

  let {
    stage,
    projects = [],
    disabled = false,
    alreadyPushed = false,
    pending = false,
    onaccepted,
  }: {
    stage: Stage;
    projects?: { id: string; name: string }[];
    disabled?: boolean;
    alreadyPushed?: boolean;
    pending?: boolean;
    onaccepted?: (pushId: string) => Promise<void>;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let pinned = $state<Stage | null>(null);
  let acceptPartial = $state(false);
  let projectMode = $state('auto');
  let projectId = $state('');
  let projectName = $state('');
  let pushing = $state(false);
  let error = $state('');
  let idempotencyKey = '';
  let submittedPayload = '';
  const activity = useActivity();
  let acceptedPushId = $state<string | null>(null);
  let activePush = $derived(
    pending ||
      activity.tasks.some(
        (task) =>
          task.kind === 'push' &&
          task.id === acceptedPushId &&
          ['queued', 'processing'].includes(task.state),
      ),
  );
  let scopeOptions = $derived([
    { value: 'auto', label: 'Match automatically' },
    ...(projects.length
      ? [{ value: 'existing', label: 'Use an existing project' }]
      : []),
    { value: 'new', label: 'Create a project' },
  ]);
  async function open() {
    if (disabled || pushing || alreadyPushed || activePush) return;
    pinned = stage;
    acceptPartial = false;
    error = '';
    idempotencyKey = crypto.randomUUID();
    submittedPayload = '';
    await tick();
    dialog?.showModal();
  }
  async function push() {
    if (
      !pinned ||
      pushing ||
      disabled ||
      alreadyPushed ||
      activePush ||
      (!pinned.coverage.complete && !acceptPartial) ||
      (projectMode === 'existing' && !projectId) ||
      (projectMode === 'new' && !projectName.trim())
    )
      return;
    const payload = {
      items: [
        { uploadId: pinned.uploadId, revisionId: pinned.id, acceptPartial },
      ],
      projectScope:
        projectMode === 'existing'
          ? { mode: 'existing', projectId }
          : projectMode === 'new'
            ? { mode: 'new', name: projectName.trim() }
            : { mode: 'auto' },
    };
    const fingerprint = JSON.stringify(payload);
    // Retry the same request safely; changed choices begin a distinct request.
    if (submittedPayload && submittedPayload !== fingerprint)
      idempotencyKey = crypto.randomUUID();
    submittedPayload = fingerprint;
    pushing = true;
    error = '';
    try {
      const response = await fetch('/api/pushes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey, ...payload }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not push this revision');
      dialog?.close();
      acceptedPushId = result.id;
      try {
        await onaccepted?.(result.id);
      } catch {}
      activity.reveal();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not push this revision';
    } finally {
      pushing = false;
    }
  }
</script>

<button
  type="button"
  class:secondary={alreadyPushed}
  disabled={disabled || pushing || alreadyPushed || activePush}
  onclick={open}
  ><Icon name={alreadyPushed ? 'success' : 'folder'} />{alreadyPushed
    ? 'Pushed to memory'
    : pushing || activePush
      ? 'Pushing to memory'
      : 'Push To Memory'}</button
>
<dialog
  bind:this={dialog}
  aria-labelledby="push-heading"
  aria-busy={pushing}
  class="push-dialog"
  oncancel={(event) => {
    if (pushing) event.preventDefault();
  }}
>
  {#if pinned}<div class="push-panel">
      <header>
        <div>
          <span class="muted">Reviewed evidence</span>
          <h2 id="push-heading">Push To Memory</h2>
        </div>
        <button
          type="button"
          class="secondary icon-button"
          disabled={pushing}
          aria-label="Close push dialog"
          onclick={() => dialog?.close()}><Icon name="close" /></button
        >
      </header>
      <div class="source-summary">
        <Icon name="file" size={22} />
        <div>
          <strong>{pinned.metadata.label}</strong><span class="muted"
            >Revision {pinned.id.slice(0, 8)}</span
          >
        </div>
      </div>
      {#if pinned.id !== stage.id}<p class="warning">
          A newer revision is available. This push keeps the revision you
          opened.
        </p>{/if}
      <fieldset class="push-options" disabled={pushing}>
        <legend class="sr-only">Push options</legend>
        {#if pinned.coverage.warnings.length}<Disclosure
            title={`Review notes (${pinned.coverage.warnings.length})`}
            icon="warning"
            ><ul>
              {#each pinned.coverage.warnings as warning}<li>
                  {warning}
                </li>{/each}
            </ul></Disclosure
          >{/if}
        {#if !pinned.coverage.complete}<label class="partial-choice"
            ><input type="checkbox" bind:checked={acceptPartial} /><span
              >Include this partial extraction</span
            ></label
          >{/if}
        <Disclosure title="Project matching" icon="folder"
          ><div class="scope-fields">
            <Select
              label="Project"
              options={scopeOptions}
              bind:value={projectMode}
              disabled={pushing}
            />
            {#if projectMode === 'existing'}<Select
                label="Existing project"
                options={[
                  { value: '', label: 'Choose a project' },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  })),
                ]}
                bind:value={projectId}
                disabled={pushing}
              />{/if}
            {#if projectMode === 'new'}<label
                >Project name<input
                  bind:value={projectName}
                  maxlength="200"
                /></label
              >{/if}
          </div></Disclosure
        >
      </fieldset>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <footer>
        <button
          type="button"
          class="secondary"
          disabled={pushing}
          onclick={() => dialog?.close()}>Back</button
        ><button
          type="button"
          onclick={push}
          disabled={disabled ||
            pushing ||
            (!pinned.coverage.complete && !acceptPartial) ||
            (projectMode === 'existing' && !projectId) ||
            (projectMode === 'new' && !projectName.trim())}
          ><Icon name={pushing ? 'clock' : 'folder'} />{pushing
            ? 'Starting...'
            : 'Push To Memory'}</button
        >
      </footer>
    </div>{/if}
</dialog>

<style>
  .push-dialog {
    width: min(30rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    overflow: auto;
  }
  .push-dialog::backdrop {
    background: rgb(12 18 30 / 0.55);
  }
  .push-panel {
    padding: 1.5rem;
  }
  header,
  footer,
  .source-summary {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  header {
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  header h2 {
    margin: 0.25rem 0 0;
    font-size: 1.3rem;
  }
  header span,
  .source-summary span {
    font-size: 0.72rem;
  }
  .source-summary {
    background: var(--canvas);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }
  .source-summary :global(.ui-icon) {
    flex-shrink: 0;
  }
  .source-summary strong {
    display: block;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .source-summary span {
    display: block;
    margin-top: 0.3rem;
  }
  .partial-choice {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.8rem 0;
    color: var(--ink);
  }
  .scope-fields {
    display: grid;
    gap: 0.8rem;
  }
  .push-options {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  footer {
    justify-content: flex-end;
    flex-wrap: wrap;
    margin-top: 1.5rem;
  }
  ul {
    padding-left: 1.2rem;
    font-size: 0.76rem;
  }
  li {
    margin: 0.5rem 0;
  }
  @media (max-width: 500px) {
    .push-panel {
      padding: 1rem;
    }
    footer {
      justify-content: flex-start;
    }
  }
</style>
