<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { Stage } from '../server/contracts';
  import { reducedMotion } from '../ui/motion';
  import {
    galleryFrames,
    formatTime,
    type ImageEvidence,
  } from '../visual-presentation';
  import Icon from './Icon.svelte';
  import Select from './Select.svelte';
  import Disclosure from './Disclosure.svelte';
  import Tooltip from './Tooltip.svelte';

  let { stage }: { stage: Stage } = $props();
  let unitValue = $state('0');
  let ready = $state(false);
  let textOpen = $state(untrack(() => stage.document!.format !== 'pdf'));
  let previewIndices = $state<Record<string, number>>({});
  let previewOpen = $state<Record<string, boolean>>({});
  let skippedOpen = $state(false);
  let document = $derived(stage.document!);
  let index = $derived(
    Math.max(0, Math.min(Number(unitValue), document.units.length - 1)),
  );
  let unit = $derived(document.units[index]);
  let render = $derived(stage.primitives.find((p) => p.id === unit.renderId));
  let review = $derived(document.review);
  let label = $derived(
    review?.unitLabels.find((l) => l.unitNumber === unit.number),
  );
  let media = $derived(
    (document.media ?? []).filter((m) => unit.mediaIds?.includes(m.id)),
  );
  let skipped = $derived(
    media.filter((m) => review?.skippedMedia?.some((s) => s.mediaId === m.id)),
  );
  let contentMedia = $derived(media.filter((m) => !skipped.includes(m)));
  let name = $derived(
    document.format === 'pptx'
      ? 'Slide'
      : document.format === 'pdf'
        ? 'Page'
        : 'Image',
  );
  let unitOptions = $derived(
    document.units.map((u, i) => ({
      value: String(i),
      label: `${u.number}${review?.unitLabels.find((l) => l.unitNumber === u.number)?.label ? ` / ${review.unitLabels.find((l) => l.unitNumber === u.number)!.label}` : ''}${u.hidden ? ' / Hidden' : ''}${u.complete ? '' : ' / Partial'}`,
    })),
  );

  function chooseUnit(next: number) {
    unitValue = String(Math.max(0, Math.min(next, document.units.length - 1)));
  }
  function previewsFor(ids: string[]) {
    return galleryFrames(
      stage.primitives.filter(
        (p): p is ImageEvidence => p.kind === 'image' && ids.includes(p.id),
      ),
    ).map((entry) => entry.sources[0]);
  }
  function choosePreview(id: string, next: number, total: number) {
    previewIndices[id] = Math.max(0, Math.min(next, total - 1));
  }
  async function revealAnchor() {
    const anchor = window.location.hash.slice(1);
    if (!anchor) return;
    const ref = anchor.replace(/^(?:text|frame|media)-/, '');
    const primitive = stage.primitives.find((p) => p.id === ref);
    const embedded = document.media?.find(
      (m) => m.id === ref || m.previewIds.includes(ref),
    );
    const target = document.units.findIndex(
      (u) =>
        u.renderId === ref ||
        u.textIds.includes(ref) ||
        (embedded && u.mediaIds?.includes(embedded.id)),
    );
    if (target >= 0) chooseUnit(target);
    if (anchor.startsWith('text-')) textOpen = true;
    if (embedded) {
      if (review?.skippedMedia?.some((s) => s.mediaId === embedded.id))
        skippedOpen = true;
      if (primitive?.kind === 'image') {
        const images = previewsFor(embedded.previewIds);
        choosePreview(
          embedded.id,
          images.findIndex((image) => image.assetId === primitive.assetId),
          images.length,
        );
        previewOpen[embedded.id] = true;
      }
    }
    await tick();
    window.document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
  }
  onMount(() => {
    ready = true;
    void revealAnchor();
    window.addEventListener('hashchange', revealAnchor);
    return () => window.removeEventListener('hashchange', revealAnchor);
  });
</script>

{#snippet previews(itemId: string, images: ImageEvidence[], caption: string)}
  {#if images.length}
    {@const selectedIndex = Math.min(
      previewIndices[itemId] ?? 0,
      images.length - 1,
    )}
    {@const image = images[selectedIndex]}
    <div
      class="preview-gallery"
      role="region"
      aria-label={`${caption} previews`}
      aria-roledescription={images.length > 1 ? 'carousel' : undefined}
    >
      {#each stage.primitives.filter((p) => p.kind === 'image' && p.assetId === image.assetId && document.media
            ?.find((m) => m.id === itemId)
            ?.previewIds.includes(p.id)) as source}<span
          id={`frame-${source.id}`}
          class="source-anchor"
        ></span>{/each}
      <figure>
        {#key image.id}
          <a
            href={`/api/assets/${image.assetId}`}
            target="_blank"
            rel="noreferrer"
            title="Open full-size preview"
            in:fade={{ duration: reducedMotion() ? 0 : 180 }}
            ><img
              src={`/api/assets/${image.assetId}`}
              alt={caption}
              loading="lazy"
            /></a
          >
        {/key}
        <figcaption>
          <span
            >{image.actualMs !== null
              ? `Clip frame ${formatTime(image.actualMs, true)}`
              : 'Source preview'}</span
          >
          {#if images.length > 1}
            <span class="gallery-navigation">
              <button
                type="button"
                class="secondary icon-button"
                aria-label="Previous preview"
                disabled={selectedIndex === 0}
                onclick={() =>
                  choosePreview(itemId, selectedIndex - 1, images.length)}
                ><Icon name="arrow-left" size={16} /></button
              >
              <span class="gallery-count" aria-live="polite"
                >{selectedIndex + 1} / {images.length}</span
              >
              <button
                type="button"
                class="secondary icon-button"
                aria-label="Next preview"
                disabled={selectedIndex === images.length - 1}
                onclick={() =>
                  choosePreview(itemId, selectedIndex + 1, images.length)}
                ><Icon name="arrow-right" size={16} /></button
              >
            </span>
          {/if}
        </figcaption>
      </figure>
    </div>
  {/if}
{/snippet}

<section class="card summary-card">
  <Disclosure title="Document summary" icon="file">
    {#if review?.summary}
      <p class="summary-text">{review.summary.text}</p>
      <div class="source-links">
        {#each document.units.filter( (u) => review?.summary?.evidenceIds.includes(u.renderId) ) as source}
          <button
            type="button"
            class="secondary"
            disabled={!ready}
            onclick={() => chooseUnit(source.number - 1)}
            ><Icon name="file" size={14} />{name} {source.number}</button
          >
        {/each}
      </div>
      <Disclosure title="Review details" icon="info">
        <p class="muted small">
          Model description / {review.unitsRead.length}/{document.units.length} pages
          or slides reviewed / {review.mediaRead.length}/{(document.media ?? [])
            .length} embedded media reviewed{review.complete
            ? ''
            : ' / Partial review'}
        </p>
        <p class="muted small">{review.model} / {review.promptVersion}</p>
      </Disclosure>
    {:else}<p class="muted">
        No generated summary for this revision. Browse the source evidence
        below.
      </p>{/if}
  </Disclosure>
</section>

<section class="card document-viewer">
  <div class="section-heading">
    <h2>Document evidence</h2>
    <span class="badge"
      >{document.units.length}
      {name.toLowerCase()}{document.units.length === 1 ? '' : 's'}</span
    >
  </div>
  <div class="navigation">
    <Tooltip text={`Previous ${name.toLowerCase()}`}
      ><button
        type="button"
        class="secondary icon-button"
        disabled={!ready || index === 0}
        onclick={() => chooseUnit(index - 1)}
        aria-label="Previous"><Icon name="arrow-left" size={18} /></button
      ></Tooltip
    >
    <div class="unit-select">
      <Select
        label={name}
        options={unitOptions}
        bind:value={unitValue}
        disabled={!ready}
      />
    </div>
    <span class="unit-total">of {document.units.length}</span>
    <Tooltip text={`Next ${name.toLowerCase()}`}
      ><button
        type="button"
        class="secondary icon-button"
        disabled={!ready || index >= document.units.length - 1}
        onclick={() => chooseUnit(index + 1)}
        aria-label="Next"><Icon name="arrow-right" size={18} /></button
      ></Tooltip
    >
  </div>
  {#if unit.hidden}<p class="warning">
      Hidden slide. Preserved as evidence; it may not have been presented.
    </p>{/if}
  {#if unit.warnings.length}<Disclosure
      title={`${unit.warnings.length} source warnings`}
      icon="warning"
      ><ul>
        {#each unit.warnings as warning}<li>{warning}</li>{/each}
      </ul></Disclosure
    >{/if}
  <div class="document-columns">
    <div class="source-render">
      {#if render?.kind === 'image'}
        <a
          class="render-link"
          id={`frame-${render.id}`}
          href={`/api/assets/${render.assetId}`}
          target="_blank"
          rel="noreferrer"
          title="Open full-size source render"
          ><img
            src={`/api/assets/${render.assetId}`}
            alt={`${name} ${unit.number} source render`}
          /></a
        >
        <div class="render-toolbar">
          <span>{name} {unit.number}</span><a
            class="button-link"
            href={`/api/assets/${render.assetId}`}
            target="_blank"
            rel="noreferrer"><Icon name="expand" size={15} />Open full size</a
          >
        </div>
      {/if}
      <Disclosure title="Source details" icon="info">
        <p class="muted small">{unit.width} x {unit.height}</p>
        {#if document.transform}<p class="muted small">
            Original {document.transform.sourceWidth} x {document.transform
              .sourceHeight}; EXIF orientation {document.transform
              .exifOrientation} applied to display. Original bytes preserved.
          </p>{/if}
      </Disclosure>
    </div>
    <div class="document-copy">
      {#if label}<div class="unit-description">
          <span class="description-label">Model description</span>
          <h3>{label.label}</h3>
          <p>{label.description}</p>
        </div>{/if}
      <Disclosure
        title="Extracted source text and notes"
        icon="transcript"
        bind:open={textOpen}
      >
        <div class="unit-text">
          {#if !unit.textIds.length}<p class="muted">
              No extracted text. Inspect the source render.
            </p>{/if}
          {#each unit.textIds as ref}
            {@const text = stage.primitives.find((p) => p.id === ref)}
            {#if text?.kind === 'text'}
              <article class="text-item" id={`text-${text.id}`}>
                <strong class="source-role"
                  >{text.role === 'notes'
                    ? 'Speaker notes (not spoken transcript)'
                    : text.role === 'ocr'
                      ? 'OCR (uncertain)'
                      : 'Native text'}</strong
                >
                <p>{text.text}</p>
                {#if text.bounds}<Disclosure
                    title="Source coordinates"
                    icon="info"
                    ><small
                      >{text.bounds.x}, {text.bounds.y} / {text.bounds.width} x {text
                        .bounds.height}
                      {text.bounds.units} / top left / canvas {text.bounds
                        .canvasWidth} x {text.bounds.canvasHeight}</small
                    ></Disclosure
                  >{/if}
              </article>
            {/if}
          {/each}
        </div>
      </Disclosure>
    </div>
  </div>

  {#if contentMedia.length}
    <div class="embedded-heading">
      <h3>Embedded media</h3>
      <span class="muted small"
        >{contentMedia.length} source asset{contentMedia.length === 1
          ? ''
          : 's'}</span
      >
    </div>
    <div class="media-grid">
      {#each contentMedia as item}
        {@const description = review?.mediaLabels.find(
          (l) => l.mediaId === item.id,
        )}
        {@const images = previewsFor(item.previewIds)}
        <article class="media-item" id={`media-${item.id}`}>
          <div class="media-heading">
            <Icon name={item.kind === 'video' ? 'video' : 'image'} size={18} />
            <h4>{description?.label ?? `Embedded ${item.kind}`}</h4>
          </div>
          {#if description}<p class="media-description">
              {description.description}
            </p>{/if}
          {#if item.kind === 'video'}
            <video
              controls
              preload="metadata"
              src={`/api/assets/${item.assetId}`}
              ><track kind="captions" /></video
            >
            {#if images.length}<Disclosure
                title={`Preview frames (${images.length})`}
                icon="image"
                bind:open={
                  () => previewOpen[item.id] ?? false,
                  (value) => (previewOpen[item.id] = value)
                }
                >{@render previews(
                  item.id,
                  images,
                  description?.label ?? 'Embedded video preview',
                )}</Disclosure
              >{/if}
          {:else}{@render previews(
              item.id,
              images,
              description?.label ?? `Embedded ${item.kind} preview`,
            )}{/if}
          <div class="media-actions">
            <a class="button-link" href={`/api/assets/${item.assetId}`} download
              ><Icon name="download" size={15} />Download {item.kind}</a
            >
          </div>
          <Disclosure title="Asset details" icon="info"
            ><p class="muted small">
              {item.sourcePart} / {item.previewOrigin.replaceAll('_', ' ')} / Slides
              {item.unitNumbers.join(', ')}
            </p></Disclosure
          >
          {#if item.warnings.length}<Disclosure
              title={`${item.warnings.length} asset warnings`}
              icon="warning"
              ><ul>
                {#each item.warnings as warning}<li>{warning}</li>{/each}
              </ul></Disclosure
            >{/if}
        </article>
      {/each}
    </div>
  {/if}
  {#if skipped.length}
    <Disclosure
      title={`Logos, stamps and decoration (${skipped.length})`}
      icon="image"
      bind:open={skippedOpen}
    >
      <p class="muted small">
        Excluded from model content descriptions. Original assets and
        classification reasons remain available.
      </p>
      {#each skipped as item}<p id={`media-${item.id}`}>
          <a href={`/api/assets/${item.assetId}`} download>{item.sourcePart}</a>
          / {review?.skippedMedia
            ?.find((s) => s.mediaId === item.id)
            ?.reason.replaceAll('_', ' ')}
        </p>{/each}
    </Disclosure>
  {/if}
  {#if document.media?.some((m) => !m.unitNumbers.length)}
    <Disclosure title="Unplaced package resources" icon="folder">
      {#each document.media.filter((m) => !m.unitNumbers.length) as item}<p>
          <a href={`/api/assets/${item.assetId}`} download
            >{review?.mediaLabels.find((l) => l.mediaId === item.id)?.label ??
              item.sourcePart}</a
          >
        </p>{/each}
    </Disclosure>
  {/if}
</section>

<style>
  .summary-card {
    margin-bottom: 1rem;
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }
  .summary-card :global(.disclosure:first-child) {
    border-bottom: 0;
  }
  .summary-text {
    white-space: pre-wrap;
    line-height: 1.8;
    color: var(--ink);
  }
  .source-links {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin: 0.8rem 0;
  }
  .source-links button {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    padding: 0.4rem 0.55rem;
  }
  .section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.1rem;
  }
  .section-heading h2 {
    margin: 0;
  }
  .navigation {
    display: flex;
    gap: 0.6rem;
    align-items: end;
    margin-bottom: 1.5rem;
  }
  .unit-select {
    min-width: 0;
    flex: 1;
    max-width: 30rem;
  }
  .unit-total {
    color: var(--muted);
    font-size: 0.76rem;
    padding-bottom: 0.8rem;
    white-space: nowrap;
  }
  .document-columns {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 1.5rem;
    grid-auto-flow: dense;
  }
  .document-copy,
  .source-render {
    min-width: 0;
  }
  .render-link {
    display: block;
  }
  img {
    display: block;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--canvas);
  }
  .render-link img {
    max-height: 42rem;
    object-fit: contain;
    transition: opacity 180ms;
  }
  .render-link:hover img {
    opacity: 0.94;
  }
  .render-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.65rem 0;
  }
  .render-toolbar > span {
    color: var(--muted);
    font-size: 0.77rem;
  }
  .render-toolbar .button-link {
    font-size: 0.75rem;
    min-height: 2rem;
    padding: 0.35rem 0.5rem;
  }
  .unit-description {
    padding: 0.2rem 0 0.8rem;
  }
  .description-label {
    color: var(--muted);
    font-size: 0.69rem;
    letter-spacing: 0.035em;
  }
  .unit-description h3 {
    font-size: clamp(1.25rem, 1.8vw, 1.7rem);
    letter-spacing: -0.025em;
    line-height: 1.25;
    margin: 0.5rem 0 0.7rem;
  }
  .unit-description p,
  .media-description {
    color: #5e5e55;
    font-size: 0.86rem;
    line-height: 1.75;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .unit-text {
    max-height: 36rem;
    overflow: auto;
    padding-right: 0.4rem;
    scrollbar-width: thin;
  }
  .text-item {
    padding: 0.8rem 0;
    border-bottom: 1px solid var(--border);
    scroll-margin-top: 2rem;
  }
  .text-item:last-child {
    border-bottom: 0;
  }
  .source-role {
    display: inline-block;
    font-size: 0.71rem;
    font-weight: 500;
    color: var(--green-ink);
    background: var(--green-soft);
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
  }
  .text-item p {
    font-size: 0.86rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0.6rem 0;
    line-height: 1.75;
  }
  .embedded-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-top: 1px solid var(--border);
    margin-top: 1.8rem;
    padding-top: 0.5rem;
  }
  .media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 1rem;
    grid-auto-flow: dense;
    margin: 0.4rem 0 1.5rem;
  }
  .media-item {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    background: var(--surface-soft);
  }
  .media-heading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .media-heading h4 {
    font-size: 0.97rem;
    font-weight: 500;
    margin: 0.1rem 0;
  }
  .media-description {
    margin: 0.65rem 0;
  }
  video {
    width: 100%;
    background: #292925;
    border-radius: 8px;
  }
  .media-actions {
    display: flex;
    margin: 0.7rem 0 0.2rem;
  }
  .media-actions .button-link {
    font-size: 0.75rem;
  }
  figure {
    margin: 0;
  }
  .preview-gallery {
    min-width: 0;
    position: relative;
  }
  .source-anchor {
    position: absolute;
    top: 0;
    left: 0;
    scroll-margin-top: 2rem;
  }
  .preview-gallery a {
    display: block;
  }
  .preview-gallery img {
    aspect-ratio: 16/9;
    object-fit: contain;
  }
  figcaption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.5rem 0;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .gallery-navigation {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .gallery-navigation .icon-button {
    width: 1.8rem;
    height: 1.8rem;
    padding: 0;
  }
  .gallery-count {
    min-width: 3rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 850px) {
    .document-columns {
      grid-template-columns: 1fr;
    }
    .unit-text {
      max-height: 30rem;
    }
  }
  @media (max-width: 500px) {
    .navigation {
      gap: 0.4rem;
    }
    .navigation :global(.icon-button) {
      width: 2.1rem;
      height: 2.5rem;
    }
    .unit-total {
      display: none;
    }
    .media-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
