<script lang="ts">
  import type { Snippet } from 'svelte';
  let { text, children }: { text: string; children: Snippet } = $props();
  const uniqueId = $props.id();
  let shown = $state(false);
  let below = $state(false);
  let anchor = $state<HTMLSpanElement>();
  let tooltip = $state<HTMLSpanElement>();

  function position() {
    if (!anchor || !tooltip) return;
    const bounds = anchor.getBoundingClientRect();
    const halfWidth = tooltip.offsetWidth / 2;
    const center = Math.max(
      halfWidth + 12,
      Math.min(
        bounds.left + bounds.width / 2,
        window.innerWidth - halfWidth - 12,
      ),
    );
    below = bounds.top - tooltip.offsetHeight - 8 < 8;
    tooltip.style.left = `${center}px`;
    tooltip.style.top = `${below ? bounds.bottom + 8 : bounds.top - 8}px`;
  }

  function tooltipEvents(node: HTMLSpanElement) {
    const show = () => {
      position();
      shown = true;
    };
    const leave = () => {
      if (!node.contains(document.activeElement)) shown = false;
    };
    const press = (event: PointerEvent) => {
      if (event.pointerType === 'touch') show();
    };
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node)) shown = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') shown = false;
    };
    const targets = node.querySelectorAll<HTMLElement>(
      'button, a[href], input, [tabindex]',
    );
    targets.forEach((target) => {
      const descriptions =
        target.getAttribute('aria-describedby')?.split(' ').filter(Boolean) ??
        [];
      target.setAttribute(
        'aria-describedby',
        [...descriptions, `${uniqueId}-tooltip`].join(' '),
      );
    });
    node.addEventListener('pointerenter', show);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('pointerdown', press);
    node.addEventListener('focusin', show);
    node.addEventListener('focusout', leave);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return {
      destroy() {
        node.removeEventListener('pointerenter', show);
        node.removeEventListener('pointerleave', leave);
        node.removeEventListener('pointerdown', press);
        node.removeEventListener('focusin', show);
        node.removeEventListener('focusout', leave);
        document.removeEventListener('pointerdown', outside);
        document.removeEventListener('keydown', escape);
        targets.forEach((target) => {
          const descriptions =
            target
              .getAttribute('aria-describedby')
              ?.split(' ')
              .filter((id) => id !== `${uniqueId}-tooltip`) ?? [];
          if (descriptions.length)
            target.setAttribute('aria-describedby', descriptions.join(' '));
          else target.removeAttribute('aria-describedby');
        });
      },
    };
  }

  $effect(() => {
    if (!shown) return;
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  });
</script>

<span class="tooltip-anchor" bind:this={anchor} use:tooltipEvents>
  {@render children()}
  <span
    bind:this={tooltip}
    id={`${uniqueId}-tooltip`}
    role="tooltip"
    class="tooltip"
    class:visible={shown}
    class:below>{text}</span
  >
</span>

<style>
  .tooltip-anchor {
    position: relative;
    display: inline-flex;
    vertical-align: middle;
  }
  .tooltip {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 70;
    width: max-content;
    max-width: min(16rem, calc(100vw - 2rem));
    transform: translate(-50%, calc(-100% + 4px));
    background: var(--ink);
    color: white;
    border-radius: 5px;
    padding: 0.4rem 0.6rem;
    font-size: 0.75rem;
    line-height: 1.45;
    font-weight: 400;
    text-align: left;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 150ms,
      transform 180ms var(--ease-out),
      visibility 150ms;
  }
  .tooltip.visible {
    opacity: 1;
    visibility: visible;
    transform: translate(-50%, -100%);
  }
  .tooltip.below {
    transform: translate(-50%, -4px);
  }
  .tooltip.below.visible {
    transform: translate(-50%, 0);
  }
</style>
