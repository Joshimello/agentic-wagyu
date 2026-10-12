<script lang="ts">
  import { untrack } from 'svelte';
  import Select from './Select.svelte';

  let { projects, value = $bindable(''), disabled = false }: {
    projects: string[]; value?: string; disabled?: boolean;
  } = $props();
  let choice = $state(untrack(() => projects.includes(value) ? `name:${value}` : value ? 'custom' : 'none'));
  let options = $derived([
    { value: 'none', label: 'No project' },
    ...projects.map((name) => ({ value: `name:${name}`, label: name })),
    { value: 'custom', label: 'Custom' },
  ]);
  $effect(() => {
    if (choice === 'none') value = '';
    else if (choice.startsWith('name:')) value = choice.slice(5);
  });
</script>

<div class="project-field">
  {#if projects.length}
    <Select label="Project" {options} bind:value={choice} {disabled} />
  {/if}
  {#if !projects.length || choice === 'custom'}
    <label>Project name (optional)
      <input bind:value maxlength="500" {disabled} placeholder="Enter a new project name" />
    </label>
    <p class="muted">Leave blank to use No project.</p>
  {/if}
</div>

<style>
  .project-field { min-width: 0; }
  label { display: block; font-size: 0.82rem; color: var(--muted); }
  input { display: block; width: 100%; margin-top: 0.4rem; }
  .project-field > label:not(:first-child) { margin-top: 0.8rem; }
  p { margin: 0.4rem 0 0; font-size: 0.75rem; }
</style>
