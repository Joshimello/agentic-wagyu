<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Disclosure from './Disclosure.svelte';
  import MediaPreview from './MediaPreview.svelte';
  import { formatTime, type GalleryFrame } from '../visual-presentation';

  let {
    frames,
    id,
    onseek,
  }: {
    frames: GalleryFrame[];
    id: string;
    onseek: (ms: number) => void;
  } = $props();
  let viewport = $state<HTMLDivElement>();
  let preview = $state<MediaPreview>();
  let selected = $state(0);
  let destination: number | null = null;
  let reducedMotion = $state(false);
  let active = $derived(frames[Math.min(selected, frames.length - 1)]);

  function choose(index: number) {
    if (!viewport || index < 0 || index >= frames.length) return;
    selected = index;
    destination = index;
    viewport.scrollTo({
      left: index * viewport.clientWidth,
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
  }
  function syncSelection() {
    if (!viewport?.clientWidth) return;
    if (
      destination !== null &&
      Math.abs(viewport.scrollLeft - destination * viewport.clientWidth) > 1
    )
      return;
    destination = null;
    selected = Math.round(viewport.scrollLeft / viewport.clientWidth);
  }
  function directScroll() {
    destination = null;
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      choose(selected + (event.key === 'ArrowRight' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      choose(event.key === 'Home' ? 0 : frames.length - 1);
    } else return;
    void tick().then(() => {
      viewport
        ?.querySelector<HTMLButtonElement>('button[data-current="true"]')
        ?.focus({ preventScroll: true });
    });
  }
  function openFrame(frame: GalleryFrame, trigger: HTMLElement) {
    const origin =
      viewport?.querySelector<HTMLElement>('button[data-current="true"]') ??
      trigger;
    void preview?.open({
      src: `/api/assets/${frame.assetId}`,
      kind: 'image',
      title: `Evidence frame at ${formatTime(frame.sources[0].actualMs ?? 0, true)}`,
      origin,
    });
  }
  onMount(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = preference.matches;
    const updateMotion = () => (reducedMotion = preference.matches);
    preference.addEventListener('change', updateMotion);
    const revealAnchor = () => {
      const frameId = window.location.hash.slice(1);
      const index = frames.findIndex((frame) =>
        frame.sources.some((source) => `frame-${source.id}` === frameId),
      );
      if (index !== -1) choose(index);
    };
    revealAnchor();
    window.addEventListener('hashchange', revealAnchor);
    const resize = new ResizeObserver(() => {
      viewport?.scrollTo({
        left: selected * (viewport?.clientWidth ?? 0),
        behavior: 'instant',
      });
    });
    if (viewport) resize.observe(viewport);
    return () => {
      preference.removeEventListener('change', updateMotion);
      window.removeEventListener('hashchange', revealAnchor);
      resize.disconnect();
    };
  });
</script>

{#if frames.length}
  <div class="gallery" aria-label="Frame evidence">
    <div
      class="gallery-viewport"
      bind:this={viewport}
      id={`gallery-${id}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="Video frames; use arrow keys to browse"
      onscroll={syncSelection}
      onpointerdown={directScroll}
      onwheel={directScroll}
      onscrollend={() => {
        destination = null;
        syncSelection();
      }}
    >
      {#each frames as frame, index (frame.assetId)}
        <div
          class="gallery-slide"
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} of ${frames.length}`}
        >
          {#each frame.sources as source}
            <span class="frame-anchor" id={`frame-${source.id}`}></span>
          {/each}
          <button
            type="button"
            class="frame-preview"
            tabindex={index === selected ? 0 : -1}
            data-current={index === selected}
            aria-label={`Open frame captured at ${formatTime(frame.sources[0].actualMs ?? 0, true)}`}
            onclick={(event) => openFrame(frame, event.currentTarget)}
            onkeydown={keyboard}
            title="Open full-size evidence frame"
          >
            <img
              src={`/api/assets/${frame.assetId}`}
              alt={`Video frame captured at ${formatTime(frame.sources[0].actualMs ?? 0, true)}`}
              loading="lazy"
              draggable="false"
            />
          </button>
        </div>
      {/each}
    </div>

    <div class="gallery-toolbar">
      <button
        class="capture-time"
        onclick={() => onseek(active.sources[0].actualMs ?? 0)}
        title="Seek to this frame in the original video"
      >
        <Icon name="play" size={15} />
        {formatTime(active.sources[0].actualMs ?? 0, true)}
      </button>
      <button
        type="button"
        class="frame-open"
        aria-label="Open frame"
        onclick={(event) => openFrame(active, event.currentTarget)}
        title="Open full-size evidence frame"
        ><Icon name="expand" size={17} /><span>Open frame</span></button
      >
      {#if frames.length > 1}
        <div class="gallery-controls">
          <button
            class="icon-button"
            onclick={() => choose(selected - 1)}
            disabled={selected === 0}
            aria-label="Previous frame"
            title="Previous frame"
            aria-controls={`gallery-${id}`}
            ><Icon name="arrow-left" size={17} /></button
          >
          <span class="counter" aria-live="polite" aria-atomic="true"
            >{selected + 1}<span class="counter-divider">/</span
            >{frames.length}</span
          >
          <button
            class="icon-button"
            onclick={() => choose(selected + 1)}
            disabled={selected === frames.length - 1}
            aria-label="Next frame"
            title="Next frame"
            aria-controls={`gallery-${id}`}
            ><Icon name="arrow-right" size={17} /></button
          >
        </div>
      {/if}
    </div>

    {#if frames.length > 1}
      <div
        class="thumbnails"
        role="group"
        aria-label="Choose an evidence frame"
      >
        {#each frames as frame, index (frame.assetId)}
          <button
            class="thumbnail"
            class:chosen={index === selected}
            aria-label={`Frame ${index + 1}, captured at ${formatTime(frame.sources[0].actualMs ?? 0, true)}`}
            aria-pressed={index === selected}
            onclick={() => choose(index)}
            title={`Frame ${index + 1}: ${formatTime(frame.sources[0].actualMs ?? 0, true)}`}
          >
            <img
              src={`/api/assets/${frame.assetId}`}
              alt=""
              loading="lazy"
              draggable="false"
            />
            <span>{formatTime(frame.sources[0].actualMs ?? 0)}</span>
          </button>
        {/each}
      </div>
    {/if}

    <Disclosure title="Frame timestamps" icon="clock">
      <dl class="frame-timestamps">
        {#each active.sources as source}
          <div>
            <dt>Captured</dt>
            <dd>
              <button
                onclick={() => onseek(source.actualMs ?? 0)}
                title={`Actual container timestamp: ${source.actualMs ?? 0} ms`}
                >{formatTime(source.actualMs ?? 0, true)}</button
              >
            </dd>
            <dt>Requested</dt>
            <dd>
              <button
                onclick={() => onseek(source.requestedMs ?? 0)}
                title={`Requested timestamp: ${source.requestedMs ?? 0} ms`}
                >{formatTime(source.requestedMs ?? 0, true)}</button
              >
            </dd>
          </div>
        {/each}
      </dl>
    </Disclosure>
  </div>
{/if}

<MediaPreview bind:this={preview} />

<style>
  .gallery {
    min-width: 0;
  }
  .gallery-viewport {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    border: 1px solid #eaeaea;
    border-radius: 10px;
    background: #f7f6f3;
  }
  .gallery-viewport::-webkit-scrollbar {
    display: none;
  }
  .gallery-slide {
    position: relative;
    flex: 0 0 100%;
    min-width: 0;
    scroll-snap-align: start;
    scroll-snap-stop: always;
  }
  .frame-preview {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 16 / 9;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .gallery-slide img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transition: opacity 180ms ease;
  }
  .frame-preview:hover img {
    opacity: 0.94;
  }
  .frame-anchor {
    position: absolute;
    inset: 0 auto auto 0;
    scroll-margin-top: 6rem;
  }
  .gallery-toolbar {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    padding: 0.65rem 0;
    flex-wrap: wrap;
  }
  .capture-time {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    background: var(--blue-soft);
    color: var(--blue-ink);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    padding: 0.38rem 0.55rem;
    border-radius: 6px;
    border: 0;
  }
  .frame-open {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.8rem;
    color: #4b4a45;
    padding: 0.4rem 0.2rem;
    border: 0;
    background: transparent;
    text-decoration: none;
  }
  .gallery-controls {
    display: flex;
    gap: 0.45rem;
    align-items: center;
    margin-left: auto;
  }
  .icon-button {
    display: inline-grid;
    place-items: center;
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    border: 1px solid #eaeaea;
    border-radius: 6px;
    background: #fff;
    color: #2f3437;
  }
  button {
    cursor: pointer;
    touch-action: manipulation;
    transition:
      background 140ms ease,
      transform 140ms ease,
      opacity 140ms ease;
  }
  button:hover:not(:disabled) {
    background: #efeee9;
  }
  button:active:not(:disabled) {
    transform: scale(0.96);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  :is(button, .gallery-viewport):focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .counter {
    display: flex;
    gap: 0.4rem;
    min-width: 3.2rem;
    justify-content: center;
    color: #4b4a45;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .counter-divider {
    color: #b9b8b2;
  }
  .thumbnails {
    display: flex;
    gap: 0.45rem;
    overflow-x: auto;
    padding: 0.1rem 0.1rem 0.6rem;
    scrollbar-width: thin;
  }
  .thumbnail {
    display: block;
    text-align: center;
    flex: 0 0 5.5rem;
    position: relative;
    overflow: hidden;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 6px;
    background: #f7f6f3;
  }
  .thumbnail.chosen {
    border-color: var(--accent);
  }
  .thumbnail img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    display: block;
  }
  .thumbnail span {
    display: block;
    padding: 0.16rem 0.2rem;
    color: #4b4a45;
    background: #f7f6f3;
    font-family: var(--font-sans);
    font-size: 0.64rem;
  }
  .frame-timestamps {
    margin: 0.2rem 0 0.5rem;
    font-size: 0.76rem;
  }
  .frame-timestamps div {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
    margin: 0.35rem 0;
  }
  .frame-timestamps dt {
    color: #787774;
  }
  .frame-timestamps dd {
    margin: 0 0.65rem 0 0;
  }
  .frame-timestamps button {
    font: inherit;
    font-family: var(--font-sans);
    color: #2f3437;
    background: transparent;
    border: 0;
    padding: 0.15rem 0;
  }
  @media (max-width: 440px) {
    .frame-open span {
      display: none;
    }
    .thumbnail {
      flex-basis: 4.5rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    button,
    .gallery-slide img {
      transition: none;
    }
  }
</style>
