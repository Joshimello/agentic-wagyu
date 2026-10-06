<script lang="ts">
  import type { Stage } from '../server/contracts';
  let { stage }: { stage: Stage } = $props();
  let index = $state(0);
  let document = $derived(stage.document!);
  let unit = $derived(
    document.units[Math.min(index, document.units.length - 1)],
  );
  let render = $derived(stage.primitives.find((p) => p.id === unit.renderId));
  let name = $derived(
    document.format === 'pptx'
      ? 'Slide'
      : document.format === 'pdf'
        ? 'Page'
        : 'Image',
  );
</script>

<section class="card document-viewer">
  <div class="navigation">
    <h2>Document evidence</h2>
    <button class="secondary" disabled={index === 0} onclick={() => index--}
      >Previous</button
    >
    <label
      >{name}<select bind:value={index}
        >{#each document.units as u, i}<option value={i}
            >{u.number}{u.hidden ? ' · Hidden' : ''}{u.complete
              ? ''
              : ' · Partial'}</option
          >{/each}</select
      ></label
    >
    <span>of {document.units.length}</span>
    <button
      class="secondary"
      disabled={index >= document.units.length - 1}
      onclick={() => index++}>Next</button
    >
  </div>
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
    <div class="unit-text">
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
    </div>
  </div>
</section>

<style>
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
