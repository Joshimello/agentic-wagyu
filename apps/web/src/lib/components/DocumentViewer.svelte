<script lang="ts">
  import { onMount } from 'svelte';
  import type { Stage } from '../server/contracts';
  let { stage }: { stage: Stage } = $props();
  let index = $state(0);
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
  let document = $derived(stage.document!);
  let unit = $derived(
    document.units[Math.min(index, document.units.length - 1)],
  );
  let render = $derived(stage.primitives.find((p) => p.id === unit.renderId));
  let review = $derived(document.review);
  let label = $derived(
    review?.unitLabels.find((l) => l.unitNumber === unit.number),
  );
  let media = $derived(
    (document.media ?? []).filter((m) => unit.mediaIds?.includes(m.id)),
  );
  let name = $derived(
    document.format === 'pptx'
      ? 'Slide'
      : document.format === 'pdf'
        ? 'Page'
        : 'Image',
  );
</script>

<section class="card document-viewer">
  <h2>Document summary</h2>
  {#if review?.summary}
    <p class="summary-text">{review.summary.text}</p>
    <p class="muted small">
      Model description · {review.unitsRead.length}/{document.units.length} pages/slides
      reviewed · {review.mediaRead.length}/{(document.media ?? []).length} embedded
      media reviewed{review.complete ? '' : ' · Partial review'}
    </p>
    <details>
      <summary>Summary sources</summary>
      <div class="source-links">
        {#each document.units.filter( (u) => review?.summary?.evidenceIds.includes(u.renderId) ) as source}
          <button
            class="secondary"
            disabled={!ready}
            onclick={() => (index = source.number - 1)}
            >{name} {source.number}</button
          >
        {/each}
      </div>
    </details>
    <p class="muted small">{review.model} · {review.promptVersion}</p>
  {:else}<p class="muted">
      No generated summary is available for this revision. The extracted source
      evidence remains available below.
    </p>{/if}
</section>
<section class="card document-viewer">
  <div class="navigation">
    <h2>Document evidence</h2>
    <button
      class="secondary"
      disabled={!ready || index === 0}
      onclick={() => index--}>Previous</button
    >
    <label
      >{name}<select bind:value={index} disabled={!ready}
        >{#each document.units as u, i}<option value={i}
            >{u.number}{review?.unitLabels.find(
              (l) => l.unitNumber === u.number,
            )?.label
              ? ` · ${review.unitLabels.find((l) => l.unitNumber === u.number)!.label}`
              : ''}{u.hidden ? ' · Hidden' : ''}{u.complete
              ? ''
              : ' · Partial'}</option
          >{/each}</select
      ></label
    >
    <span>of {document.units.length}</span>
    <button
      class="secondary"
      disabled={!ready || index >= document.units.length - 1}
      onclick={() => index++}>Next</button
    >
  </div>
  {#if label}<h3>{label.label}</h3>
    <p>{label.description}</p>{/if}
  {#if unit.hidden}<p class="warning">
      Hidden slide — included as source evidence, not proof it was presented.
    </p>{/if}
  {#if unit.warnings.length}<ul class="warning">
      {#each unit.warnings as warning}<li>{warning}</li>{/each}
    </ul>{/if}
  <div class="document-columns">
    <div>
      {#if render?.kind === 'image'}<a
          href={`/api/assets/${render.assetId}`}
          target="_blank"
          rel="noreferrer"
          ><img
            src={`/api/assets/${render.assetId}`}
            alt={`${name} ${unit.number} source render`}
          /></a
        >{/if}
      <p class="muted small">
        {name}
        {unit.number} · {unit.width} × {unit.height} · Click to open full render
      </p>
      {#if document.transform}<p class="muted small">
          Original {document.transform.sourceWidth} × {document.transform
            .sourceHeight}; EXIF orientation {document.transform
            .exifOrientation} applied to display. Original bytes preserved.
        </p>{/if}
    </div>
    <details class="unit-text" open={document.format !== 'pdf'}>
      <summary>Extracted source text and notes</summary>
      {#if !unit.textIds.length}<p class="muted">
          No extracted text. Inspect the source render.
        </p>{/if}
      {#each unit.textIds as ref}{@const text = stage.primitives.find(
          (p) => p.id === ref,
        )}{#if text?.kind === 'text'}<article id={`text-${text.id}`}>
            <strong
              >{text.role === 'notes'
                ? 'Speaker notes (not spoken transcript)'
                : text.role === 'ocr'
                  ? 'OCR (uncertain)'
                  : 'Native text'}</strong
            >
            <p>{text.text}</p>
            {#if text.bounds}<details>
                <summary>Source coordinates</summary><small
                  >{text.bounds.x}, {text.bounds.y} · {text.bounds.width} × {text
                    .bounds.height}
                  {text.bounds.units} · top left · canvas {text.bounds
                    .canvasWidth} × {text.bounds.canvasHeight}</small
                >
              </details>{/if}
          </article>{/if}{/each}
    </details>
  </div>
  {#if media.length}<h3>Embedded media</h3>
    <div class="media-grid">
      {#each media as item}{@const description = review?.mediaLabels.find(
          (l) => l.mediaId === item.id,
        )}
        <article class="media-item" id={`media-${item.id}`}>
          <h4>{description?.label ?? `Embedded ${item.kind}`}</h4>
          {#if description}<p>{description.description}</p>{/if}
          {#if item.kind === 'video'}
            <video
              controls
              preload="metadata"
              src={`/api/assets/${item.assetId}`}
            >
              <track kind="captions" />
            </video>
          {/if}
          <div class="previews">
            {#each item.previewIds as ref}{@const image = stage.primitives.find(
                (p) => p.id === ref,
              )}
              {#if image?.kind === 'image'}<figure>
                  <a
                    href={`/api/assets/${image.assetId}`}
                    target="_blank"
                    rel="noreferrer"
                    ><img
                      src={`/api/assets/${image.assetId}`}
                      alt={description?.label ??
                        `Embedded ${item.kind} preview`}
                      loading="lazy"
                    /></a
                  >
                  {#if image.actualMs !== null}<figcaption>
                      Clip frame {(image.actualMs / 1000).toFixed(2)}s
                    </figcaption>{/if}
                </figure>{/if}
            {/each}
          </div>
          <p class="muted small">
            {item.sourcePart} · {item.previewOrigin.replaceAll('_', ' ')} · Slides
            {item.unitNumbers.join(', ')}
          </p>
          <a class="small" href={`/api/assets/${item.assetId}`} download
            >Download original embedded {item.kind}</a
          >
          {#each item.warnings as warning}<p class="warning small">
              {warning}
            </p>{/each}
        </article>
      {/each}
    </div>{/if}
  {#if document.media?.some((m) => !m.unitNumbers.length)}<details>
      <summary>Unplaced package resources</summary>
      {#each document.media.filter((m) => !m.unitNumbers.length) as item}
        <p>
          <a href={`/api/assets/${item.assetId}`} download
            >{review?.mediaLabels.find((l) => l.mediaId === item.id)?.label ??
              item.sourcePart}</a
          >
        </p>
      {/each}
    </details>{/if}
</section>

<style>
  .summary-text {
    white-space: pre-wrap;
    line-height: 1.7;
  }
  .source-links {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 20px;
  }
  .media-item {
    min-width: 0;
  }
  .media-item h4 {
    margin: 8px 0;
  }
  .previews {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 8px;
  }
  figure {
    margin: 0;
  }
  figcaption {
    color: #66768b;
    font-size: 12px;
  }
  video {
    width: 100%;
    background: #101b2a;
    border-radius: 8px;
  }
  .navigation {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  .navigation h2 {
    flex: 1;
  }
  .navigation label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .document-columns {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 24px;
  }
  img {
    width: 100%;
    border: 1px solid #dfe5ec;
    border-radius: 8px;
  }
  article {
    padding: 12px 0;
    border-bottom: 1px solid #edf0f4;
  }
  article strong {
    font-size: 12px;
    color: #66768b;
  }
  article p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  details {
    color: #66768b;
    font-size: 12px;
  }
  .unit-text {
    max-height: 800px;
    overflow: auto;
  }
  .document-viewer {
    margin-bottom: 24px;
  }
  @media (max-width: 850px) {
    .document-columns {
      grid-template-columns: 1fr;
    }
    .unit-text {
      max-height: none;
    }
  }
</style>
