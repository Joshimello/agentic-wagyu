<script lang="ts">
  import type { Stage } from '../server/contracts';
  import { localMeetingTime, sourceProjectName } from '../source-organization';
  import SourceProjectField from './SourceProjectField.svelte';
  import Icon from './Icon.svelte';

  type Source = { id: string; filename: string; metadata: Stage['metadata']; currentRevisionId: string | null };
  let { projects, onupdated }: { projects: string[]; onupdated: (id: string) => Promise<void> } = $props();
  let dialog = $state<HTMLDialogElement>();
  let source = $state<Source | null>(null);
  let label = $state('');
  let meetingTime = $state('');
  let projectName = $state('');
  let saving = $state(false);
  let error = $state('');
  let previousTime = '';

  export function open(value: Source) {
    source = $state.snapshot(value);
    label = value.metadata.label || value.filename;
    meetingTime = localMeetingTime(value.metadata.sourceTime);
    previousTime = meetingTime;
    projectName = sourceProjectName(value.metadata);
    error = '';
    dialog?.showModal();
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!source || saving) return;
    saving = true;
    error = '';
    try {
      const response = await fetch(`/api/uploads/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevisionId: source.currentRevisionId,
          previous: {
            label: source.metadata.label,
            sourceTime: source.metadata.sourceTime,
            projectName: sourceProjectName(source.metadata),
          },
          label: label.trim(),
          sourceTime: meetingTime === previousTime ? source.metadata.sourceTime
            : meetingTime ? new Date(meetingTime).toISOString() : null,
          projectName: projectName.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Source details could not be saved');
      await onupdated(source.id);
      dialog?.close();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Source details could not be saved';
    } finally { saving = false; }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="source-details-heading"
  oncancel={(event) => { if (saving) event.preventDefault(); }}>
  <form onsubmit={save}>
    <header>
      <div><span class="muted">Source details</span><h2 id="source-details-heading">Edit details</h2></div>
      <button type="button" class="secondary icon-button" aria-label="Close details" disabled={saving}
        onclick={() => dialog?.close()}><Icon name="close" /></button>
    </header>
    {#if source}
      <p class="original-name">Original file: {source.filename}</p>
      <label>Name<input bind:value={label} required maxlength="500" disabled={saving} /></label>
      <label>Meeting date and time (optional)<input type="datetime-local" bind:value={meetingTime} disabled={saving} /></label>
      {#key source}<SourceProjectField {projects} bind:value={projectName} disabled={saving} />{/key}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <footer>
        <button type="button" class="secondary" disabled={saving} onclick={() => dialog?.close()}>Cancel</button>
        <button disabled={saving || !label.trim()}><Icon name="check" size={16} />{saving ? 'Saving...' : 'Save details'}</button>
      </footer>
    {/if}
  </form>
</dialog>

<style>
  dialog { width: min(32rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; padding: 1.5rem;
    border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--ink); }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  header span { font-size: 0.75rem; }
  h2 { margin: 0.25rem 0 0; }
  .original-name { color: var(--muted); font-size: 0.78rem; overflow-wrap: anywhere; margin: 1.1rem 0; }
  label { display: block; color: var(--muted); font-size: 0.82rem; margin-bottom: 1rem; }
  input { display: block; width: 100%; margin-top: 0.4rem; }
  footer { justify-content: flex-end; margin-top: 1.5rem; gap: 0.5rem; flex-wrap: wrap; }
  footer button { padding-inline: 0.9rem; }
</style>
