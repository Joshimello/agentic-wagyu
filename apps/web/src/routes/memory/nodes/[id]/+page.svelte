<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '../../../../lib/components/Icon.svelte';
  import Disclosure from '../../../../lib/components/Disclosure.svelte';
  import { askInPanel, nextMeetingQuestion } from '../../../../lib/ui/ask.svelte';
  import { shortDate } from '../../../../lib/dates';
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

<a
  class="button-link"
  href={data.project ? '/' : `/memory?knownVersion=${data.version}`}
  ><Icon name="arrow-left" size={16} />{data.project ? 'Projects' : 'Library'}</a
>
<p class="muted">
  {#each data.parents as parent}<a href={link(parent.id)}>{parent.title}</a> ·
  {/each}
</p>
{#if !data.project}<span class="badge"
    >{data.node.kind}{data.archived ? ' · Historical source' : ''}</span
  >{/if}
<div class="page-title">
  <h1>{data.node.current.title}</h1>
  {#if data.project}<button
      onclick={() => askInPanel(nextMeetingQuestion, data.node.id)}
      ><Icon name="help" size={17} />Prepare next meeting</button
    >{/if}
</div>
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
{#if data.project}
  {#if data.project.toReview}<a class="review-banner" href={`/changes?project=${data.node.id}`}
      ><strong
        >{data.project.toReview} proposed change{data.project.toReview === 1
          ? ''
          : 's'}</strong
      >
      waiting for review<Icon name="arrow-right" size={16} /></a
    >{/if}
  <section class="card listing">
    <div class="listing-head">
      <h2>Meetings</h2>
      <a class="button-link secondary" href="/sources">Add</a>
    </div>
    {#each [...data.project.meetings].sort( (a, b) => (b.date ?? '').localeCompare(a.date ?? ''), ) as meeting}
      <a class="listing-row" href={`/staging/${meeting.uploadId}`}>
        <Icon name="video" size={18} />
        <span class="grow">{meeting.label || meeting.filename}</span>
        <span class="muted">{shortDate(meeting.date)}</span>
      </a>
    {:else}<p class="muted listing-empty">No recorded meetings yet.</p>{/each}
  </section>
  <section class="card listing">
    <div class="listing-head">
      <h2>Decisions and commitments</h2>
      <a class="button-link secondary" href={`/memory/map?project=${data.node.id}`}
        >Open memory</a
      >
    </div>
    {#each data.project.approved as item}
      <a class="listing-row" href={`/changes/reviews/${item.eventId}`}>
        <span
          class="dot"
          data-state={item.value.kind === 'decision'
            ? 'decision'
            : item.value.status}
        ></span>
        <span class="grow"
          >{item.value.text}<small
            >{item.value.kind === 'decision'
              ? 'Decision'
              : `${item.value.owner ?? 'No owner'} · ${item.value.deadline ? `due ${shortDate(item.value.deadline)}` : 'no date'}`}{item
              .reviewerAdded.length
              ? ' · edited in review'
              : ''}</small
          ></span
        >
        <span class="badge" data-state={item.value.status ?? 'decision'}
          >{item.value.kind === 'decision'
            ? 'Approved'
            : item.value.status === 'completion_claimed'
              ? 'Claimed done'
              : item.value.status === 'completion_verified'
                ? 'Verified done'
                : (item.value.status ?? '').replaceAll('_', ' ')}</span
        >
      </a>
    {:else}<p class="muted listing-empty">
        Nothing approved yet. Compare two meetings in Changes and review what
        it finds.
      </p>{/each}
  </section>
{/if}
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
    <h2>{data.node.kind === 'project' ? 'Topics' : 'Discussions'}</h2>
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
  .page-title {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .page-title button {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex: none;
  }
  .review-banner {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.7rem 1rem;
    margin: 1rem 0;
    border-radius: 8px;
    background: var(--yellow-soft);
    color: var(--yellow-ink);
  }
  .review-banner :global(.ui-icon) {
    margin-left: auto;
  }
  .listing {
    padding: 0;
    margin: 1rem 0;
    overflow: hidden;
  }
  .listing-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.8rem 1.1rem;
    border-bottom: 1px solid var(--border);
  }
  .listing-head h2 {
    margin: 0;
    font-size: 1rem;
  }
  .listing-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.75rem 1.1rem;
    border-top: 1px solid var(--border);
    color: var(--ink);
    font-size: 0.9rem;
    transition: background 150ms;
  }
  .listing-head + .listing-row {
    border-top: 0;
  }
  .listing-row:hover {
    background: var(--surface-soft);
    text-decoration: none;
  }
  .listing-row .grow {
    flex: 1;
    min-width: 0;
  }
  .listing-row small {
    display: block;
    color: var(--muted);
    font-size: 0.78rem;
  }
  .listing-empty {
    padding: 0.9rem 1.1rem;
    margin: 0;
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    flex: none;
    box-shadow: inset 0 0 0 1.6px var(--muted);
  }
  .dot[data-state='decision'],
  .dot[data-state='completion_verified'] {
    background: var(--accent);
    box-shadow: none;
  }
  .dot[data-state='completion_claimed'] {
    background: var(--yellow-ink);
    box-shadow: none;
  }
  .badge[data-state='completion_claimed'] {
    background: var(--yellow-soft);
    color: var(--yellow-ink);
  }
</style>
