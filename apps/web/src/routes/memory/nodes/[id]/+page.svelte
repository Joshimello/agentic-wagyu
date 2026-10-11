<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '../../../../lib/components/Icon.svelte';
  import Disclosure from '../../../../lib/components/Disclosure.svelte';
  let { data } = $props();
  let organizing = $state(false),
    actionError = $state('');
  async function organize() {
    if (!data.source) return;
    organizing = true;
    actionError = '';
    try {
      const response = await fetch('/api/pushes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workflow: 'summary',
          organizationMode: 'scope',
          idempotencyKey: `scope:${data.source.revisionId}:${crypto.randomUUID()}`,
          projectScope: { mode: 'auto' },
          items: [
            {
              uploadId: data.source.uploadId,
              revisionId: data.source.revisionId,
              acceptPartial: !data.source.coverage.complete,
            },
          ],
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? 'Could not start organization');
      await goto(`/pushes/${result.id}`);
    } catch (error) {
      actionError =
        error instanceof Error ? error.message : 'Could not start organization';
      organizing = false;
    }
  }
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

<a class="button-link" href={`/memory?knownVersion=${data.version}`}
  ><Icon name="arrow-left" size={16} />Memory snapshot {data.version}</a
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
    </p>{/if}{#if data.node.current.warnings.length}<Disclosure
      title={`${data.node.current.warnings.length} source and uncertainty notes`}
      icon="warning"
    >
      <ul>
        {#each data.node.current.warnings as warning}<li>{warning}</li>{/each}
      </ul>
    </Disclosure>{/if}
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
{#if data.unassignedCount && !data.archived}<section class="card">
    <p>
      {data.unassignedCount} substantive discussions have no project/topic assignment.
    </p>
    <button disabled={organizing} onclick={organize}
      >{organizing
        ? 'Starting organization…'
        : 'Organize unassigned discussions'}</button
    >{#if actionError}<p class="error">{actionError}</p>{/if}
  </section>{/if}
{#if data.children.length}<section>
    <h2>{data.node.kind === 'project' ? 'Topics' : 'Discussion segments'}</h2>
    <div class="children">
      {#each data.children as child}<article class="card">
          <span class="badge"
            >{child.kind}{child.segment?.contextOnly ? ' · Context' : ''}</span
          >
          <h3><a href={link(child.id, child.versionId)}>{child.title}</a></h3>
          {#if data.node.kind === 'topic' && child.sourceTitle}<p class="muted">
              {child.sourceTitle}
            </p>{/if}
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
<div class="card history">
  <Disclosure
    title={`Recorded summary history / ${data.node.history.length} versions`}
    icon="history"
    >{#each data.node.history as version}<p>
        <a href={link(data.node.id, version.id)}
          >Version {version.commitVersion}</a
        >
        · {version.model} · {version.promptVersion}
      </p>{/each}</Disclosure
  >
</div>

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
