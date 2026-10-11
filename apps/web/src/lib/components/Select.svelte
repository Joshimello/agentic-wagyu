<script lang="ts">
  import { onDestroy } from 'svelte';
  import { popover } from '../ui/motion';
  import Icon from './Icon.svelte';

  let {
    options,
    value = $bindable(''),
    label,
    disabled = false,
    name,
  }: {
    options: { value: string; label: string }[];
    value?: string;
    label: string;
    disabled?: boolean;
    name?: string;
  } = $props();
  const uniqueId = $props.id();
  let open = $state(false);
  let highlighted = $state(0);
  let field = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let selected = $derived(options.find((option) => option.value === value));
  let typeahead = '';
  let typeaheadTimer: ReturnType<typeof setTimeout>;

  function show() {
    if (disabled || !options.length) return;
    highlighted = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    open = true;
  }

  function choose(index: number) {
    if (!options[index]) return;
    value = options[index].value;
    open = false;
    trigger?.focus();
  }

  function keydown(event: KeyboardEvent) {
    if (disabled) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) show();
      else if (event.key === 'ArrowDown')
        highlighted = (highlighted + 1) % options.length;
      else if (event.key === 'ArrowUp')
        highlighted = (highlighted + options.length - 1) % options.length;
      if (event.key === 'Home') highlighted = 0;
      if (event.key === 'End') highlighted = options.length - 1;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(highlighted);
      else show();
    } else if (event.key === 'Escape') {
      if (open) event.preventDefault();
      open = false;
    } else if (event.key === 'Tab') {
      open = false;
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      show();
      typeahead += event.key.toLocaleLowerCase();
      clearTimeout(typeaheadTimer);
      typeaheadTimer = setTimeout(() => (typeahead = ''), 600);
      const index = options.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(typeahead),
      );
      if (index >= 0) highlighted = index;
    }
  }

  function outside(event: PointerEvent) {
    if (open && !field?.contains(event.target as Node)) open = false;
  }

  $effect(() => {
    if (open)
      document
        .getElementById(`${uniqueId}-option-${highlighted}`)
        ?.scrollIntoView({ block: 'nearest' });
  });

  onDestroy(() => clearTimeout(typeaheadTimer));
</script>

<svelte:window onpointerdown={outside} />
<div class="select-field" bind:this={field}>
  <span id={`${uniqueId}-label`} class="select-label">{label}</span>
  {#if name}<input type="hidden" {name} {value} />{/if}
  <button
    bind:this={trigger}
    class="select-trigger"
    type="button"
    {disabled}
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={`${uniqueId}-options`}
    aria-labelledby={`${uniqueId}-label ${uniqueId}-value`}
    aria-activedescendant={open
      ? `${uniqueId}-option-${highlighted}`
      : undefined}
    onclick={() => (open ? (open = false) : show())}
    onkeydown={keydown}
  >
    <span id={`${uniqueId}-value`}>{selected?.label ?? 'Choose an option'}</span
    >
    <span class="select-caret" class:turned={open}
      ><Icon name="chevron-down" size={15} /></span
    >
  </button>
  {#if open}
    <div
      class="select-options"
      id={`${uniqueId}-options`}
      role="listbox"
      aria-labelledby={`${uniqueId}-label`}
      transition:popover
    >
      {#each options as option, index}
        <button
          id={`${uniqueId}-option-${index}`}
          type="button"
          role="option"
          aria-selected={value === option.value}
          tabindex="-1"
          class:highlighted={highlighted === index}
          onpointermove={() => (highlighted = index)}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => choose(index)}
        >
          <span>{option.label}</span>{#if value === option.value}<Icon
              name="check"
              size={15}
            />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .select-field {
    position: relative;
    min-width: 0;
  }
  .select-label {
    display: block;
    margin-bottom: 0.4rem;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .select-trigger {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    width: 100%;
    min-height: 2.7rem;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--border);
    font-size: 0.86rem;
    font-weight: 400;
    text-align: left;
  }
  .select-trigger:hover {
    background: var(--surface-soft);
  }
  .select-trigger > span:first-child {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  .select-caret {
    display: flex;
    flex: none;
    align-items: center;
    transition: transform 220ms var(--ease-out);
  }
  .select-caret.turned {
    transform: rotate(180deg);
  }
  .select-options {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 30;
    width: 100%;
    min-width: min(12rem, 100%);
    max-height: 18rem;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    background: var(--surface);
    box-shadow: 0 6px 25px rgb(0 0 0 / 0.04);
    transform-origin: top center;
  }
  .select-options button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    width: 100%;
    padding: 0.6rem 0.65rem;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ink);
    font-size: 0.84rem;
    font-weight: 400;
    text-align: left;
  }
  .select-options button.highlighted {
    background: var(--blue-soft);
    color: var(--blue-ink);
  }
  .select-options button > span {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
</style>
