<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { shortDate } from '../../lib/dates';
  import Icon from '../../lib/components/Icon.svelte';
  let { data } = $props();
  let projectId = $state(
      untrack(
        () =>
          data.choices.projects.find((p) => p.id === data.preferred)?.id ??
          data.choices.projects[0]?.id ??
          '',
      ),
    ),
    earlier = $state(''),
    later = $state('');
  // Start from the two most recent meetings; the choice stays editable.
  function latestPair(id: string) {
    const sorted = [
      ...(data.choices.projects.find((p) => p.id === id)?.meetings ?? []),
    ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    earlier = sorted.at(-2)?.revisionId ?? '';
    later = sorted.length > 1 ? (sorted.at(-1)?.revisionId ?? '') : '';
  }
  untrack(() => latestPair(projectId));
  const projectWaiting = (id: string) =>
    data.pending
      .filter((p) => p.projectId === id)
      .reduce((n, p) => n + p.count, 0);
  const picture = (id: string) =>
    [...(data.choices.projects.find((p) => p.id === id)?.meetings ?? [])]
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .find((m) => m.frameAssetId)?.frameAssetId;
  const waiting = (comparisonId: string) =>
    data.pending.find((p) => p.comparisonId === comparisonId)?.count ?? 0;
  let busy = $state(false),
    error = $state('');
  let meetings = $derived(
    data.choices.projects.find((p) => p.id === projectId)?.meetings ?? [],
  );
  const meetingName = (revisionId: string) => {
    const m = meetings.find((m) => m.revisionId === revisionId);
    return m ? m.label || m.filename : 'Earlier version';
  };
  let approved = $derived(
    data.approved.filter((v) => v.projectId === projectId),
  );
  let decisions = $derived(approved.filter((v) => v.value.kind === 'decision'));
  let commitments = $derived(
    approved.filter((v) => v.value.kind === 'commitment'),
  );
  let comparisons = $derived(
    data.comparisons.filter((c) => c.input.projectId === projectId),
  );
  let toReview = $derived(comparisons.filter((c) => waiting(c.id)));
  let finished = $derived(comparisons.filter((c) => !waiting(c.id)));
  const statusNames: Record<string, string> = {
    planned: 'Planned',
    in_progress: 'In progress',
    completion_claimed: 'Reported done',
    completion_verified: 'Verified done',
    canceled: 'Canceled',
  };
  const stateNames: Record<string, string> = {
    completed: 'Reviewed',
    queued: 'Waiting',
    processing: 'Comparing…',
    failed: 'Failed',
    canceled: 'Canceled',
  };
  let requestKey = '';
  let requestPayload = '';
  async function create() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const input = {
        projectId,
        earlierRevisionId: earlier,
        laterRevisionId: later,
      };
      if (requestPayload !== JSON.stringify(input)) {
        requestPayload = JSON.stringify(input);
        requestKey = crypto.randomUUID();
      }
      const r = await fetch('/api/comparisons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey: requestKey }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      await goto(`/changes/${body.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create comparison';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Changes | Chronicler</title></svelte:head>
<div class="heading">
  <div>
    <h1>Changes</h1>
    <p class="muted">What changed between meetings, and what you approved.</p>
  </div>
</div>
{#if data.choices.projects.length > 1}
  <div class="projects" role="group" aria-label="Project">
    {#each data.choices.projects as p (p.id)}
      <button
        class="project"
        aria-pressed={projectId === p.id}
        onclick={() => {
          projectId = p.id;
          latestPair(p.id);
        }}
      >
        <span class="thumb"
          >{#if picture(p.id)}<img
              src={`/api/assets/${picture(p.id)}`}
              alt=""
              decoding="async"
            />{:else}<Icon name="folder" size={20} />{/if}</span
        >
        <span class="name"
          ><strong>{p.title}</strong><span class="muted"
            >{p.meetings.length} meeting{p.meetings.length === 1
              ? ''
              : 's'}{#if projectWaiting(p.id)}
              · <span class="to-review">{projectWaiting(p.id)} to review</span
              >{/if}</span
          ></span
        >
      </button>
    {/each}
  </div>
{/if}

{#if !data.choices.projects.length}
  <section class="card empty">
    <strong>No projects yet</strong>
    <p class="muted">
      Add two meetings to a project, then compare them here.
    </p>
    <a href="/sources">Go to Sources</a>
  </section>
{:else}
  {#if toReview.length}
    <section class="review" aria-labelledby="review-heading">
      <h2 id="review-heading">Waiting for your review</h2>
      {#each toReview as c (c.id)}
        <a class="review-row" href={`/changes/${c.id}`}>
          <span class="pair-names"
            >{meetingName(c.input.earlierRevisionId)}<Icon
              name="arrow-right"
              size={14}
            />{meetingName(c.input.laterRevisionId)}</span
          >
          <span class="count"
            >{waiting(c.id)} proposed change{waiting(c.id) > 1 ? 's' : ''}</span
          >
          <span class="go">Review<Icon name="chevron-right" size={14} /></span>
        </a>
      {/each}
    </section>
  {/if}

  <section class="card compare" aria-labelledby="compare-heading">
    <h2 id="compare-heading">Compare two meetings</h2>
    {#if meetings.length < 2}
      <p class="muted">
        This project needs two meetings before they can be compared.
      </p>
    {:else}
      <div class="compare-row">
        {#each ['Earlier', 'Later'] as side, index}
          {#if index}<span class="arrow" aria-hidden="true"
              ><Icon name="arrow-right" size={18} /></span
            >{/if}
          <label
            ><span class="muted">{side} meeting</span><select
              value={side === 'Earlier' ? earlier : later}
              onchange={(e) => {
                if (side === 'Earlier') earlier = e.currentTarget.value;
                else later = e.currentTarget.value;
              }}
              ><option value="">Choose a meeting</option
              >{#each meetings as m}<option
                  value={m.revisionId}
                  disabled={m.revisionId ===
                    (side === 'Earlier' ? later : earlier)}
                  >{m.label || m.filename}{m.date
                    ? ` · ${shortDate(m.date)}`
                    : ''}</option
                >{/each}</select
            ></label
          >
        {/each}
        <button
          disabled={busy || !earlier || !later || earlier === later}
          onclick={create}>{busy ? 'Starting…' : 'Compare'}</button
        >
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    {/if}
  </section>

  <section aria-labelledby="state-heading">
    <h2 id="state-heading">Approved for this project</h2>
    {#if !approved.length}
      <p class="muted">
        Nothing approved yet. Approved decisions and commitments appear here.
      </p>
    {:else}
      <div class="state">
        {#each [{ name: 'Decisions', icon: 'success', items: decisions }, { name: 'Commitments', icon: 'list', items: commitments }] as group}
          <div class="card group">
            <h3>
              <Icon name={group.icon} size={16} />{group.name}<span
                class="muted">{group.items.length}</span
              >
            </h3>
            {#each group.items as v (v.itemId)}
              <article>
                <p>{v.value.text}</p>
                <div class="meta">
                  {#if v.value.status}<span
                      class="pill"
                      class:done={v.value.status === 'completion_verified'}
                      class:claimed={v.value.status === 'completion_claimed'}
                      >{statusNames[v.value.status] ?? v.value.status}</span
                    >{/if}
                  {#if v.value.kind === 'commitment'}
                    <span class:missing={!v.value.owner}
                      ><Icon name="users" size={13} />{v.value.owner ??
                        'No owner'}</span
                    >
                    <span class:missing={!v.value.deadline}
                      ><Icon name="clock" size={13} />{v.value.deadline
                        ? `Due ${shortDate(v.value.deadline)}`
                        : 'No date'}</span
                    >
                  {/if}
                  <a href={`/changes/reviews/${v.eventId}`}>History</a>
                </div>
              </article>
            {:else}
              <p class="muted none">None yet.</p>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if finished.length}
    <section aria-labelledby="past-heading">
      <h2 id="past-heading">Earlier comparisons</h2>
      <div class="card past">
        {#each finished as c (c.id)}
          <a class="past-row" href={`/changes/${c.id}`}>
            <span class="pair-names"
              >{meetingName(c.input.earlierRevisionId)}<Icon
                name="arrow-right"
                size={13}
              />{meetingName(c.input.laterRevisionId)}</span
            >
            <span class="muted">{stateNames[c.state] ?? c.state}</span>
            <span class="muted date">{shortDate(new Date(c.createdAt).toISOString())}</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}
{/if}

<style>
  .heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.8rem;
  }
  h1 {
    font-size: 1.9rem;
    margin: 0 0 0.3rem;
  }
  .heading p {
    margin: 0;
  }
  h2 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.8rem;
  }
  section {
    margin-bottom: 2rem;
  }
  label {
    display: grid;
    gap: 0.35rem;
    font-size: 0.8rem;
    min-width: 0;
  }
  select {
    width: 100%;
    min-width: 0;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: inherit;
    font-size: 0.9rem;
  }
  .projects {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    gap: 0.7rem;
    margin-bottom: 2rem;
  }
  .project {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.6rem;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--border);
    border-radius: 10px;
    font-weight: 400;
    text-align: left;
    min-width: 0;
  }
  .project:hover {
    background: var(--surface);
    border-color: var(--muted);
  }
  .project[aria-pressed='true'] {
    border-color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .thumb {
    flex: none;
    width: 4.6rem;
    aspect-ratio: 16 / 10;
    border-radius: 6px;
    overflow: hidden;
    background: var(--canvas);
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .name {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
    font-size: 0.8rem;
  }
  .name strong {
    font-size: 0.9rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .to-review {
    color: var(--yellow-ink);
  }
  .review {
    display: grid;
    gap: 0.5rem;
  }
  .review h2 {
    margin-bottom: 0.3rem;
  }
  .review-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.9rem 1.2rem;
    border-radius: 10px;
    background: var(--yellow-soft);
    color: var(--ink);
    transition: transform 150ms var(--ease-out);
  }
  .review-row:hover {
    text-decoration: none;
    transform: translateY(-1px);
  }
  .pair-names {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-weight: 500;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .count {
    margin-left: auto;
    color: var(--yellow-ink);
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .go {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-weight: 600;
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .compare {
    padding: 1.3rem 1.5rem;
  }
  .compare-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto;
    align-items: end;
    gap: 0.9rem;
  }
  .arrow {
    color: var(--muted);
    padding-bottom: 0.6rem;
  }
  .compare-row button {
    padding: 0.62rem 1.3rem;
  }
  .state {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    align-items: start;
  }
  .group {
    padding: 1.2rem 1.4rem 0.4rem;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0 0 0.4rem;
  }
  h3 .muted {
    font-weight: 400;
  }
  article {
    padding: 0.9rem 0;
    border-top: 1px solid var(--border);
  }
  article p {
    margin: 0 0 0.55rem;
    line-height: 1.5;
    max-width: 68ch;
  }
  .none {
    padding: 0.4rem 0 0.9rem;
    margin: 0;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.9rem;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .meta .missing {
    color: var(--red-ink);
  }
  .meta a {
    margin-left: auto;
    color: var(--muted);
  }
  .pill {
    background: var(--canvas);
    color: var(--ink);
    border-radius: 999px;
    padding: 0.1rem 0.6rem;
  }
  .pill.claimed {
    background: var(--yellow-soft);
    color: var(--yellow-ink);
  }
  .pill.done {
    background: var(--blue-soft);
    color: var(--blue-ink);
  }
  .past {
    padding: 0.3rem 1.4rem;
  }
  .past-row {
    display: grid;
    grid-template-columns: 1fr auto 5rem;
    align-items: center;
    gap: 1rem;
    padding: 0.8rem 0;
    color: var(--ink);
    font-size: 0.88rem;
    border-top: 1px solid var(--border);
  }
  .past-row:first-child {
    border-top: 0;
  }
  .past-row .pair-names {
    font-weight: 400;
  }
  .date {
    text-align: right;
  }
  .empty {
    display: grid;
    gap: 0.4rem;
    justify-items: start;
  }
  .empty p {
    margin: 0;
  }
  @media (max-width: 900px) {
    .state {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 650px) {
    .heading {
      flex-direction: column;
      align-items: stretch;
    }
    .compare-row {
      grid-template-columns: 1fr;
    }
    .arrow {
      display: none;
    }
    .review-row {
      flex-wrap: wrap;
    }
    .count {
      margin-left: 0;
    }
  }
</style>
