<script lang="ts">
  import { onDestroy } from 'svelte';
  import { reducedMotion } from '../ui/motion';
  import Icon from './Icon.svelte';

  let {
    items,
    active = $bindable(''),
    onselect,
  }: {
    items: { id: string; label: string; icon?: string }[];
    active?: string;
    onselect?: (id: string) => void;
  } = $props();
  let buttons: (HTMLButtonElement | undefined)[] = [];
  let targets: number[] = [];
  let values: number[] = [];
  let frame: number | undefined;
  let last = 0;

  function register(node: HTMLButtonElement, index: number) {
    buttons[index] = node;
    start();
    return {
      destroy() {
        buttons[index] = undefined;
      },
    };
  }

  // One idle-free loop keeps marker scale and label movement in step.
  function animate(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const blend = 1 - Math.exp(-dt / 0.085);
    let moving = false;
    buttons.forEach((button, index) => {
      if (!button) return;
      const target = Math.max(
        targets[index] ?? 0,
        items[index]?.id === active ? 1 : 0,
      );
      const next =
        (values[index] ?? 0) + (target - (values[index] ?? 0)) * blend;
      const settled = Math.abs(target - next) < 0.0015;
      values[index] = settled ? target : next;
      button.style.setProperty('--effect', String(values[index]));
      if (!settled) moving = true;
    });
    frame = moving ? requestAnimationFrame(animate) : undefined;
  }

  function start() {
    if (typeof window === 'undefined') return;
    if (reducedMotion()) {
      buttons.forEach((button, index) =>
        button?.style.setProperty(
          '--effect',
          items[index]?.id === active ? '1' : '0',
        ),
      );
      return;
    }
    if (frame !== undefined) return;
    last = performance.now();
    frame = requestAnimationFrame(animate);
  }

  function proximity(event: PointerEvent) {
    if (event.pointerType === 'touch' || reducedMotion()) return;
    buttons.forEach((button, index) => {
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
      const p = Math.max(0, 1 - distance / 85);
      targets[index] = p * p * (3 - 2 * p);
    });
    start();
  }

  function reset() {
    targets = targets.map(() => 0);
    start();
  }
  function keyboard(event: KeyboardEvent, index: number) {
    const vertical = ['ArrowDown', 'ArrowRight'].includes(event.key)
      ? 1
      : ['ArrowUp', 'ArrowLeft'].includes(event.key)
        ? -1
        : 0;
    if (vertical) {
      event.preventDefault();
      buttons[(index + vertical + items.length) % items.length]?.focus();
    }
    if (event.key === 'Home') {
      event.preventDefault();
      buttons[0]?.focus();
    }
    if (event.key === 'End') {
      event.preventDefault();
      buttons[items.length - 1]?.focus();
    }
  }

  $effect(() => {
    active;
    items;
    start();
  });
  onDestroy(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
</script>

<nav
  class="line-sidebar"
  aria-label="Source sections"
  onpointermove={proximity}
  onpointerleave={reset}
>
  <ul>
    {#each items as item, index (item.id)}
      <li>
        <button
          type="button"
          use:register={index}
          aria-current={active === item.id ? 'location' : undefined}
          onclick={() => {
            active = item.id;
            onselect?.(item.id);
          }}
          onkeydown={(event) => keyboard(event, index)}
          onfocus={() => {
            targets[index] = 1;
            start();
          }}
          onblur={() => {
            targets[index] = 0;
            start();
          }}
        >
          <span class="marker" aria-hidden="true"></span>
          <span class="sidebar-label"
            >{#if item.icon}<Icon name={item.icon} size={15} />{/if}<span
              >{item.label}</span
            ></span
          >
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .line-sidebar {
    position: sticky;
    top: 1.5rem;
    align-self: start;
    min-width: 0;
    padding: 1rem 0;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    position: relative;
  }
  li:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: -0.65rem;
    width: 12px;
    height: 1px;
    background: var(--border);
  }
  button {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    min-height: 2.2rem;
    position: relative;
    padding: 0.4rem 0 0.4rem 2.1rem;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    text-align: left;
    font-weight: 400;
    font-size: 0.82rem;
  }
  button:hover {
    background: transparent;
  }
  button:active {
    transform: none;
    opacity: 0.75;
  }
  .marker {
    position: absolute;
    left: 0;
    top: 50%;
    width: 24px;
    height: 1.5px;
    background: color-mix(
      in srgb,
      var(--accent) calc(var(--effect, 0) * 100%),
      #b4b4ac
    );
    transform: translateY(-50%) scaleX(calc(0.55 + var(--effect, 0) * 0.45));
    transform-origin: left center;
  }
  .sidebar-label {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    text-align: left;
    transform: translateX(calc(var(--effect, 0) * 5px));
    color: color-mix(
      in srgb,
      var(--blue-ink) calc(var(--effect, 0) * 100%),
      var(--muted)
    );
  }
  button[aria-current='location'] .sidebar-label {
    font-weight: 550;
  }
  @media (max-width: 1000px) {
    .line-sidebar {
      position: relative;
      top: auto;
      padding: 0;
      overflow-x: auto;
      margin-bottom: 1rem;
    }
    .marker,
    li::after {
      display: none;
    }
    ul {
      flex-direction: row;
      gap: 0.3rem;
      padding: 4px;
      background: #efeee9;
      border: 1px solid var(--border);
      border-radius: 8px;
      width: fit-content;
      min-width: 100%;
    }
    li {
      flex: 1;
    }
    button {
      justify-content: flex-start;
      padding: 0.55rem 0.65rem;
      white-space: nowrap;
      min-height: 2.3rem;
    }
    button[aria-current='location'] {
      background: var(--surface);
      color: var(--blue-ink);
    }
    .sidebar-label {
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sidebar-label {
      transform: none;
    }
  }
  @media (max-width: 600px) {
    ul {
      width: 100%;
    }
    li {
      min-width: 0;
    }
    button {
      white-space: normal;
      padding: 0.5rem 0.4rem;
      min-height: 3.1rem;
    }
    .sidebar-label {
      gap: 0.35rem;
      line-height: 1.25;
      font-size: 0.75rem;
    }
    .sidebar-label > span {
      text-wrap: pretty;
      text-align: left;
    }
  }
</style>
