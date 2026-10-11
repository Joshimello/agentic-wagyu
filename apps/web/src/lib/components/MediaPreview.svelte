<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Icon from './Icon.svelte';

  type Preview = {
    src: string;
    kind: 'image' | 'video' | 'document';
    title: string;
    origin?: HTMLElement;
    downloadSrc?: string;
    startTime?: number;
    onclose?: (time: number | undefined) => void;
  };
  let item = $state<Preview | null>(null);
  let dialog = $state<HTMLDialogElement>();
  let surface = $state<HTMLDivElement>();
  let shade = $state<HTMLDivElement>();
  let video = $state<HTMLVideoElement>();
  let surfaceAnimation: Animation | undefined;
  let shadeAnimation: Animation | undefined;
  let returnFocus: HTMLElement | null = null;
  let previousOverflow: string | undefined;
  let scrollContainer: HTMLElement | null = null;
  let transitionVersion = 0;
  let closeReported = false;
  const uniqueId = $props.id();

  function reduceMotion() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function stopPlayback() {
    if (video) {
      video.pause();
    }
  }
  function applyStartTime() {
    if (
      !video ||
      video.readyState < 1 ||
      item?.kind !== 'video' ||
      item.startTime === undefined ||
      !Number.isFinite(item.startTime)
    )
      return;
    const end = Number.isFinite(video.duration)
      ? video.duration
      : item.startTime;
    video.currentTime = Math.max(0, Math.min(item.startTime, end));
  }
  function reportClose() {
    if (!item || closeReported) return;
    closeReported = true;
    const time =
      item.kind === 'video'
        ? video && video.readyState >= 1 && Number.isFinite(video.currentTime)
          ? video.currentTime
          : item.startTime !== undefined && Number.isFinite(item.startTime)
            ? item.startTime
            : undefined
        : undefined;
    item.onclose?.(time);
  }
  function cancelAnimations() {
    surfaceAnimation?.cancel();
    shadeAnimation?.cancel();
    surfaceAnimation = undefined;
    shadeAnimation = undefined;
  }
  function presentation() {
    return {
      transform: surface ? getComputedStyle(surface).transform : 'none',
      opacity: surface ? getComputedStyle(surface).opacity : '1',
      shadeOpacity: shade ? getComputedStyle(shade).opacity : '1',
    };
  }
  function originTransform() {
    if (!surface || !item?.origin?.isConnected)
      return 'translateY(12px) scale(.97)';
    const source = item.origin.getBoundingClientRect();
    const target = surface.getBoundingClientRect();
    if (!source.width || !source.height || !target.width || !target.height)
      return 'translateY(12px) scale(.97)';
    const x = source.x + source.width / 2 - (target.x + target.width / 2);
    const y = source.y + source.height / 2 - (target.y + target.height / 2);
    return `translate(${x}px, ${y}px) scale(${source.width / target.width}, ${source.height / target.height})`;
  }
  function restorePage() {
    if (previousOverflow !== undefined) {
      if (scrollContainer) scrollContainer.style.overflow = previousOverflow;
      previousOverflow = undefined;
      scrollContainer = null;
    }
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  function finishClose(version: number) {
    if (version !== transitionVersion) return;
    cancelAnimations();
    stopPlayback();
    reportClose();
    dialog?.close();
    item = null;
    restorePage();
  }
  export async function open(value: Preview): Promise<void> {
    const continuing = Boolean(dialog?.open);
    const current = continuing ? presentation() : undefined;
    const version = ++transitionVersion;
    stopPlayback();
    cancelAnimations();
    if (
      continuing &&
      item &&
      (item.src !== value.src || item.kind !== value.kind)
    )
      reportClose();
    closeReported = false;
    if (!continuing && previousOverflow === undefined) {
      const focused = window.document.activeElement;
      returnFocus =
        focused instanceof HTMLElement && focused !== window.document.body
          ? focused
          : (value.origin ?? null);
      scrollContainer =
        window.document.querySelector<HTMLElement>('.workspace-scroll') ??
        window.document.documentElement;
      previousOverflow = scrollContainer.style.overflow;
      scrollContainer.style.overflow = 'hidden';
    }
    item = value;
    await tick();
    if (version !== transitionVersion) return;
    applyStartTime();
    if (!dialog?.open) dialog?.showModal();
    if (!continuing)
      dialog
        ?.querySelector<HTMLButtonElement>('.preview-close')
        ?.focus({ preventScroll: true });
    if (reduceMotion() || !surface || !shade) return;
    surfaceAnimation = surface.animate(
      [
        {
          transform: current?.transform ?? originTransform(),
          opacity: current?.opacity ?? 0.45,
        },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' },
    );
    shadeAnimation = shade.animate(
      [{ opacity: current?.shadeOpacity ?? 0 }, { opacity: 1 }],
      { duration: 160, easing: 'ease-out', fill: 'both' },
    );
  }
  export function close() {
    const version = ++transitionVersion;
    if (!dialog?.open) {
      stopPlayback();
      reportClose();
      item = null;
      restorePage();
      return;
    }
    const current = presentation();
    stopPlayback();
    cancelAnimations();
    reportClose();
    if (reduceMotion() || !surface || !shade) {
      finishClose(version);
      return;
    }
    surfaceAnimation = surface.animate(
      [
        { transform: current.transform, opacity: current.opacity },
        { transform: originTransform(), opacity: 0 },
      ],
      { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'both' },
    );
    shadeAnimation = shade.animate(
      [{ opacity: current.shadeOpacity }, { opacity: 0 }],
      { duration: 160, easing: 'ease-in', fill: 'both' },
    );
    void surfaceAnimation.finished.then(
      () => finishClose(version),
      () => {},
    );
  }
  function outside(event: PointerEvent) {
    if (surface && !surface.contains(event.target as Node)) close();
  }
  onDestroy(() => {
    ++transitionVersion;
    stopPlayback();
    cancelAnimations();
    if (typeof window !== 'undefined') {
      reportClose();
      dialog?.close();
      restorePage();
    }
  });
</script>

<dialog
  class="media-preview"
  bind:this={dialog}
  aria-label="Media preview"
  aria-describedby={`${uniqueId}-title`}
  onpointerdown={outside}
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
  onclose={() => {
    if (!dialog?.open) {
      stopPlayback();
      reportClose();
      item = null;
      restorePage();
    }
  }}
>
  <div class="preview-shade" bind:this={shade} aria-hidden="true"></div>
  <div class="preview-surface" bind:this={surface}>
    <header class="preview-heading">
      <div class="preview-title">
        <Icon
          name={item?.kind === 'video'
            ? 'video'
            : item?.kind === 'document'
              ? 'file'
              : 'image'}
          size={20}
        />
        <h2 id={`${uniqueId}-title`}>{item?.title ?? 'Media preview'}</h2>
      </div>
      <div class="preview-actions">
        {#if item}<a
            class="button-link secondary preview-download"
            href={item.downloadSrc ?? item.src}
            download
            aria-label="Download original media"
            title="Download the original file"
            ><Icon name="download" size={20} /><span>Download</span></a
          >{/if}
        <button
          type="button"
          class="secondary icon-button preview-close"
          aria-label="Close media preview"
          title="Close preview (Escape)"
          onclick={close}><Icon name="close" size={22} /></button
        >
      </div>
    </header>
    <div class="preview-media">
      {#if item?.kind === 'image'}
        <img src={item.src} alt={item.title} draggable="false" />
      {:else if item?.kind === 'video'}
        <video
          bind:this={video}
          src={item.src}
          controls
          preload="metadata"
          onloadedmetadata={applyStartTime}><track kind="captions" /></video
        >
      {:else if item?.kind === 'document'}
        <iframe
          src={item.src}
          title={item.title}
          sandbox=""
          referrerpolicy="no-referrer"
        ></iframe>
      {/if}
    </div>
    {#if item?.kind === 'document'}<p class="document-note">
        Use Download if this document does not display.
      </p>{/if}
  </div>
</dialog>

<style>
  .media-preview {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    overflow: hidden;
  }
  .media-preview[open] {
    display: grid;
    place-items: center;
  }
  .media-preview::backdrop {
    background: transparent;
  }
  .preview-shade {
    position: absolute;
    inset: 0;
    background: rgb(0 0 0 / 0.65);
  }
  .preview-surface {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: min(80vw, 88rem);
    height: 80dvh;
    min-width: 0;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.18);
    border-radius: 12px;
    background: var(--surface, #fff);
    transform-origin: center;
  }
  .preview-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.65rem 0.85rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .preview-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  .preview-title :global(svg) {
    flex-shrink: 0;
    color: var(--accent);
  }
  h2 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 550;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preview-actions {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-shrink: 0;
  }
  .preview-download {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.65rem;
    min-height: 2.3rem;
    font-size: 0.78rem;
  }
  .preview-close {
    display: grid;
    place-items: center;
    min-width: 2.3rem;
    min-height: 2.3rem;
    padding: 0.35rem;
  }
  .preview-media {
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #171b22;
  }
  img,
  video,
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border: 0;
    object-fit: contain;
  }
  iframe {
    background: var(--surface);
  }
  .document-note {
    margin: 0;
    padding: 0.45rem 0.85rem;
    font-size: 0.75rem;
    color: var(--muted);
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  @media (max-width: 700px) {
    .preview-surface {
      width: 92vw;
      height: 84dvh;
      border-radius: 10px;
    }
    .preview-heading {
      gap: 0.5rem;
      padding: 0.55rem 0.6rem;
    }
    .preview-title {
      gap: 0.4rem;
    }
    .preview-download {
      padding: 0.45rem;
    }
    .preview-download span {
      display: none;
    }
    h2 {
      font-size: 0.8rem;
    }
  }
  @media (prefers-contrast: more) {
    .preview-surface {
      border: 2px solid var(--ink);
    }
    .preview-shade {
      background: rgb(0 0 0 / 0.8);
    }
  }
</style>
