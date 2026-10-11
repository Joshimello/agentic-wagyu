<script lang="ts">
  let {
    value = null,
    label = '',
    ariaLabel = '',
    state = 'processing',
    compact = false,
  }: {
    value?: number | null;
    label?: string;
    ariaLabel?: string;
    state?: string;
    compact?: boolean;
  } = $props();
  let percent = $derived(
    value === null ? null : Math.max(0, Math.min(100, Math.round(value))),
  );
  let active = $derived(['queued', 'processing', 'canceling'].includes(state));
</script>

<div class="progress-bar" class:compact class:inactive={!active}>
  <div class="progress-copy">
    <span
      >{label || (state === 'queued' ? 'Waiting to start' : 'Processing')}</span
    ><strong>{percent === null ? 'Working...' : `${percent}%`}</strong>
  </div>
  <div
    class="progress-track"
    role="progressbar"
    aria-label={ariaLabel || label || 'Processing progress'}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={percent ?? undefined}
    aria-valuetext={percent === null
      ? label || 'Processing'
      : `${percent}%${label ? ` / ${label}` : ''}`}
  >
    <span
      class="progress-fill"
      class:indeterminate={percent === null}
      style:width={percent === null ? '30%' : `${percent}%`}
    ></span>
  </div>
</div>

<style>
  .progress-bar {
    min-width: 0;
    width: 100%;
  }
  .progress-copy {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.8rem;
    font-size: 0.78rem;
    margin-bottom: 0.45rem;
    color: var(--muted);
  }
  .progress-copy span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .progress-copy strong {
    color: var(--accent, #2563eb);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .progress-track {
    height: 0.4rem;
    overflow: hidden;
    border-radius: 4px;
    background: var(--blue-soft, #e8f0ff);
  }
  .progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent, #2563eb);
    transition: width 350ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .compact .progress-copy {
    font-size: 0.7rem;
    gap: 0.5rem;
  }
  .compact .progress-track {
    height: 0.25rem;
  }
  .inactive .progress-fill {
    opacity: 0.65;
  }
  .indeterminate {
    animation: travel 1.4s ease-in-out infinite alternate;
  }
  @keyframes travel {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(235%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }
    .indeterminate {
      animation: none;
    }
  }
</style>
