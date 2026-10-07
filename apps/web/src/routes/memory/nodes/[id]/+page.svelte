<script lang="ts">
  let { data } = $props();
  const link = (id: string, versionId?: string) =>
    `/memory/nodes/${id}?knownVersion=${data.version}${versionId ? `&versionId=${versionId}` : ''}`;
  const evidence = (id: string) =>
    `/evidence/${data.source?.revisionId}/${id}?knownVersion=${data.version}`;
  const locator = (l: any) =>
    l.kind === 'media'
      ? `${Math.floor(l.startMs / 60000)}:${String(Math.floor((l.startMs / 1000) % 60)).padStart(2, '0')}–${Math.floor(l.endMs / 60000)}:${String(Math.floor((l.endMs / 1000) % 60)).padStart(2, '0')}`
      : l.kind === 'slide'
        ? `Slide ${l.slide}`
        : l.kind === 'page'
          ? `Page ${l.page}`
          : 'Source text';
</script>

<a href={`/memory?knownVersion=${data.version}`}
  >← Memory snapshot {data.version}</a
>
<p class="muted">
  {#each data.parents as parent}<a href={link(parent.id)}>{parent.title}</a> ·
  {/each}
</p>
<span class="badge"
  >{data.node.kind} · Recorded version {data.node.current
    .commitVersion}{data.archived ? ' · Historical source' : ''}</span
>
<h1>{data.node.current.title}</h1>
<section class="card">
  <p class="summary">{data.node.current.summary}</p>
  {#if data.node.current.keywords.length}<p class="muted">
      {data.node.current.keywords.join(' · ')}
    </p>{/if}{#if data.node.current.warnings.length}<details>
      <summary
        >{data.node.current.warnings.length} source and uncertainty notes</summary
      >
      <ul>
        {#each data.node.current.warnings as warning}<li>{warning}</li>{/each}
      </ul>
    </details>{/if}
</section>
{#if data.source}<p class="muted">
    {data.source.filename} · {data.source.metadata.sourceTime ??
      'Event date unknown'} · {data.source.coverage.complete
      ? 'Complete extraction'
      : 'Partial extraction explicitly accepted'}
  </p>
  <p>
    <a
      href={`/staging/${data.source.uploadId}?revision=${data.source.revisionId}`}
      >Pinned staging revision</a
    >
    · <a href={`/api/assets/${data.source.rawAssetId}`}>Original file</a>
  </p>{/if}
{#if data.children.length}<section>
    <h2>{data.node.kind === 'project' ? 'Topics' : 'Discussion segments'}</h2>
    <div class="children">
      {#each data.children as child}<article class="card">
          <span class="badge"
            >{child.kind}{child.segment?.contextOnly ? ' · Context' : ''}</span
          >
          <h3><a href={link(child.id, child.versionId)}>{child.title}</a></h3>
          <p>{child.summary}</p>
        </article>{/each}
    </div>
  </section>{/if}
{#if data.source?.content}<section class="card">
    <h2>Original evidence</h2>
    <p class="muted">
      Exact source text and source-mapped images beneath this summary.
    </p>
    {#each data.source.content.texts as text}<article class="turn">
        <p class="muted">
          <a href={evidence(text.primitiveId)}>{locator(text.locator)}</a
          >{text.speaker ? ` · ${text.speaker}` : ''}
        </p>
        <p>{text.text}</p>
      </article>{/each}
    {#if data.source.content.images.length}<h3>Slides and linked frames</h3>
      <div class="images">
        {#each data.source.content.images as image}{#if image.kind === 'image'}<figure
            >
              <a href={evidence(image.id)}
                ><img
                  loading="lazy"
                  src={`/api/assets/${image.assetId}`}
                  alt={locator(image.locator)}
                /></a
              >
              <figcaption>{locator(image.locator)}</figcaption>
            </figure>{/if}{/each}
      </div>{/if}
  </section>{/if}
<details class="card history">
  <summary
    >Recorded summary history · {data.node.history.length} versions</summary
  >{#each data.node.history as version}<p>
      <a href={link(data.node.id, version.id)}
        >Version {version.commitVersion}</a
      >
      · {version.model} · {version.promptVersion}
    </p>{/each}
</details>

<style>
  h1 {
    margin: 16px 0;
  }
  .summary,
  article p {
    white-space: pre-wrap;
  }
  section {
    margin: 22px 0;
  }
  .children {
    display: grid;
    gap: 14px;
  }
  .turn {
    border-top: 1px solid #edf0f4;
    padding: 12px 0;
  }
  .images {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 12px;
  }
  figure {
    margin: 0;
  }
  img {
    width: 100%;
    border-radius: 8px;
  }
  figcaption {
    color: #66768b;
    font-size: 13px;
  }
  .history {
    margin-top: 24px;
  }
</style>
