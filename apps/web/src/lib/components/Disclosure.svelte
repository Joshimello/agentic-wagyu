<script lang="ts">
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { reducedMotion } from '../ui/motion';
  import Icon from './Icon.svelte';

  let {
    title,
    icon,
    chevron = false,
    open = $bindable(false),
    children,
    id,
  }: {
    title: string;
    icon?: string;
    chevron?: boolean;
    open?: boolean;
    children: Snippet;
    id?: string;
  } = $props();
  const uniqueId = $props.id();
  let panelId = $derived(id ?? `${uniqueId}-panel`);
</script>

<div class="disclosure" class:expanded={open}>
  <button
    class="disclosure-trigger"
    type="button"
    aria-expanded={open}
    aria-controls={panelId}
    onclick={() => (open = !open)}
  >
    {#if icon}<Icon name={icon} size={16} />{/if}
    <span>{title}</span><span
      class="disclosure-sign"
      class:turned={chevron && open}
      ><Icon
        name={chevron ? 'chevron-down' : open ? 'minus' : 'plus'}
        size={16}
      /></span
    >
  </button>
  {#if open}
    <div
      id={panelId}
      class="disclosure-body"
      transition:slide={{
        duration: reducedMotion() ? 0 : 260,
        easing: cubicOut,
      }}
    >
      <div class="disclosure-content">{@render children()}</div>
    </div>
  {/if}
</div>

<style>
  .disclosure {
    border-bottom: 1px solid var(--border);
  }
  .disclosure-trigger {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.55rem;
    width: 100%;
    padding: 0.8rem 0;
    background: transparent;
    border: 0;
    border-radius: 4px;
    text-align: left;
    font-size: 0.84rem;
    font-weight: 450;
    color: var(--muted);
  }
  .disclosure-trigger:hover,
  .expanded .disclosure-trigger {
    background: transparent;
    color: var(--ink);
  }
  .disclosure-trigger:active {
    transform: none;
    opacity: 0.7;
  }
  .disclosure-sign {
    margin-left: auto;
    display: flex;
    align-items: center;
    flex: none;
    transition: transform 220ms var(--ease-out);
  }
  .disclosure-sign.turned {
    transform: rotate(180deg);
  }
  .disclosure-content {
    padding: 0.2rem 0 1rem;
    font-size: 0.87rem;
  }
</style>
