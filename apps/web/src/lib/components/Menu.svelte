<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { popover } from '../ui/motion';
  import Icon from './Icon.svelte';

  let {
    label,
    icon = 'more',
    children,
  }: { label: string; icon?: string; children: Snippet } = $props();
  const uniqueId = $props.id();
  let open = $state(false);
  let container = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();

  async function show(focusFirst = false) {
    open = true;
    await tick();
    if (focusFirst)
      panel
        ?.querySelector<HTMLElement>('a[href], button:not(:disabled)')
        ?.focus();
  }

  function outside(event: PointerEvent) {
    if (open && !container?.contains(event.target as Node)) open = false;
  }

  function keydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
      trigger?.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const actions = Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled)',
        ) ?? [],
      );
      const index = actions.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? actions.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) %
              actions.length;
      actions[next]?.focus();
    }
  }

  function closeAfterAction(event: MouseEvent) {
    if ((event.target as Element).closest('a, button')) open = false;
  }

  function panelEvents(node: HTMLDivElement) {
    const focusout = (event: FocusEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        !container?.contains(event.relatedTarget)
      )
        open = false;
    };
    node.addEventListener('click', closeAfterAction);
    node.addEventListener('focusout', focusout);
    return {
      destroy() {
        node.removeEventListener('click', closeAfterAction);
        node.removeEventListener('focusout', focusout);
      },
    };
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={keydown} />
<div class="menu" bind:this={container}>
  <button
    bind:this={trigger}
    class="menu-trigger secondary"
    type="button"
    aria-expanded={open}
    aria-controls={`${uniqueId}-menu`}
    onclick={() => (open ? (open = false) : show())}
    onkeydown={(event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        show(true);
      }
    }}
  >
    <Icon name={icon} size={18} /><span>{label}</span>
  </button>
  {#if open}
    <div
      bind:this={panel}
      use:panelEvents
      class="menu-panel"
      id={`${uniqueId}-menu`}
      role="group"
      aria-label={label}
      transition:popover
    >
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
    display: inline-block;
  }
  .menu-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.55rem 0.8rem;
    font-size: 0.84rem;
  }
  .menu-panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 35;
    min-width: 12rem;
    max-width: min(24rem, calc(100vw - 2rem));
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px;
    box-shadow: 0 6px 25px rgb(0 0 0 / 0.04);
    transform-origin: top right;
  }
  .menu-panel :global(a),
  .menu-panel :global(button) {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    text-align: left;
    padding: 0.6rem 0.7rem;
    font-size: 0.84rem;
    background: transparent;
    color: var(--ink);
    border: 0;
    border-radius: 4px;
    font-weight: 400;
  }
  .menu-panel :global(a:hover),
  .menu-panel :global(button:hover) {
    background: var(--canvas);
    text-decoration: none;
  }
</style>
