<script lang="ts">
  let { data } = $props();
  let primitive = $derived(data.primitive);
</script>

<a href={`/memory?knownVersion=${data.memoryVersion}`}
  >← Memory snapshot {data.memoryVersion}</a
>
<h1>Source evidence</h1>
<section class="card">
  <h2>{data.filename}</h2>
  <p class="muted">Pinned revision {data.revisionId} · {primitive.role}</p>
  {#if primitive.kind === 'text'}<blockquote>
      {data.excerpt ?? primitive.text}
    </blockquote>{:else}<img
      src={`/api/assets/${primitive.assetId}`}
      alt="Cited original visual evidence"
    />{/if}
  <pre>{JSON.stringify(primitive.locator, null, 2)}</pre>
  <p>
    <a
      href={`/staging/${data.uploadId}?revision=${data.revisionId}#${primitive.kind === 'text' ? 'text' : 'frame'}-${primitive.id}`}
      >Inspect pinned source context</a
    >
    ·
    <a href={`/api/assets/${data.rawAssetId}`} target="_blank" rel="noreferrer"
      >Open original file</a
    >
  </p>
</section>

<style>
  h1 {
    margin: 16px 0;
  }
  blockquote {
    white-space: pre-wrap;
    border-left: 3px solid #ccd6e2;
    margin: 12px 0;
    padding: 12px;
  }
  img {
    max-width: 100%;
    max-height: 900px;
  }
</style>
