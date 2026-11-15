<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { shortDate } from '../../../lib/dates';
  import Icon from '../../../lib/components/Icon.svelte';
  import {
    askInPanel,
    nextMeetingQuestion,
  } from '../../../lib/ui/ask.svelte';
  let { data } = $props();

  // A view-only account is always a student; others may preview that view.
  const viewer = $derived(data.access === 'viewer');
  let chosenRole = $state<'leader' | 'student'>('leader');
  let role = $derived(viewer ? 'student' : chosenRole);
  let canReview = $derived(role === 'leader' && !data.readOnly);
  // Ticking a task is open to students too: it records progress, not memory.
  let canTick = $derived(!data.readOnly);
  let me = $state('');
  onMount(() => {
    try {
      if (localStorage.getItem('chronicler-memory-role') === 'student')
        chosenRole = 'student';
      me = localStorage.getItem('chronicler-memory-person') ?? '';
    } catch {}
  });
  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };

  const statusNames: Record<string, string> = {
    planned: 'Planned',
    in_progress: 'In progress',
    completion_claimed: 'Reported done',
    completion_verified: 'Verified done',
    canceled: 'Canceled',
  };
  let map = $derived(data.map);
  let entries = $derived(
    map
      ? [
          ...map.items.map((i) => ({
            ...i,
            key: i.id,
            state: i.state as 'accepted' | 'replaced' | 'pending',
            comparisonId: null as string | null,
            why: null as string | null,
          })),
          ...map.pending.map((p) => ({
            ...p,
            key: p.id,
            state: 'pending' as 'accepted' | 'replaced' | 'pending',
            done: false,
            itemId: null as string | null,
            eventId: null as string | null,
            previousId: null as string | null,
            edited: false,
            createdAt: null as string | null,
          })),
        ]
      : [],
  );
  type Entry = (typeof entries)[number];
  const kindName = (e: Entry) =>
    e.value.kind === 'decision' ? 'Decision' : 'Task';
  let accepted = $derived(entries.filter((e) => e.state === 'accepted'));
  let pending = $derived(entries.filter((e) => e.state === 'pending'));
  let replaced = $derived(entries.filter((e) => e.state === 'replaced'));
  let people = $derived(
    [
      ...new Set(
        entries.flatMap((e) => (e.value.owner ? [e.value.owner] : [])),
      ),
    ].sort(),
  );
  let mine = $derived(
    me
      ? entries.filter(
          (e) =>
            e.state !== 'replaced' &&
            e.value.kind === 'commitment' &&
            e.value.owner === me,
        )
      : [],
  );
  const meetingName = (revisionId: string | null) =>
    map?.meetings.find((m) => m.revisionId === revisionId)?.name ?? '';
  // The newest meeting that produced accepted items, for the student summary.
  let recent = $derived.by(() => {
    const last = [...(map?.meetings ?? [])]
      .reverse()
      .find((m) => accepted.some((e) => e.meeting === m.revisionId));
    return last
      ? {
          meeting: last,
          items: accepted.filter((e) => e.meeting === last.revisionId),
        }
      : null;
  });
  let loose = $derived(
    entries.filter(
      (e) => !map?.meetings.some((m) => m.revisionId === e.meeting),
    ),
  );

  let filter = $state<'all' | 'decision' | 'commitment'>('all');
  // Completed tasks sink below the ones still open.
  const openFirst = (list: Entry[]) => [
    ...list.filter((e) => !e.done),
    ...list.filter((e) => e.done),
  ];
  let listed = $derived(
    openFirst(
      accepted.filter((e) => filter === 'all' || e.value.kind === filter),
    ),
  );
  let tasks = $derived(
    openFirst(
      me
        ? mine
        : entries.filter(
            (e) => e.state !== 'replaced' && e.value.kind === 'commitment',
          ),
    ),
  );
  let selectedKey = $state('');
  let selected = $derived(
    entries.find((e) => e.key === selectedKey) ??
      (canReview ? pending[0] : undefined) ??
      accepted.at(-1) ??
      entries[0],
  );
  let history = $derived(
    selected?.itemId
      ? entries.filter((e) => e.itemId === selected.itemId)
      : [],
  );
  let previous = $derived(
    selected?.previousId
      ? entries.find((e) => e.key === selected.previousId)
      : undefined,
  );

  let busy = $state(''),
    error = $state(''),
    notice = $state('');
  async function review(entry: Entry, action: 'approve' | 'reject') {
    const r = await fetch(`/api/change-proposals/${entry.key}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        action,
        reason:
          action === 'approve'
            ? 'Accepted on the Memory page'
            : 'Rejected on the Memory page',
      }),
    });
    if (!r.ok) throw new Error((await r.json()).error ?? 'Review failed');
  }
  async function act(list: Entry[], action: 'approve' | 'reject') {
    if (busy) return;
    busy = list.length > 1 ? 'all' : list[0].key;
    error = '';
    try {
      for (const entry of list) await review(entry, action);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Review failed';
    } finally {
      await invalidateAll();
      busy = '';
    }
  }

  async function tick(e: Entry, box: HTMLInputElement) {
    if (!e.itemId || busy) return;
    busy = e.key;
    error = '';
    try {
      const r = await fetch(`/api/memory/tasks/${e.itemId}/done`, {
        method: box.checked ? 'POST' : 'DELETE',
      });
      if (!r.ok)
        throw new Error((await r.json()).error ?? 'Could not update this task');
    } catch (err) {
      box.checked = e.done;
      error = err instanceof Error ? err.message : 'Could not update this task';
    } finally {
      await invalidateAll();
      busy = '';
    }
  }
  let reporting = $state(false),
    note = $state('');
  async function report() {
    if (!selected || !map || !note.trim() || busy) return;
    busy = 'report';
    error = '';
    try {
      const r = await fetch('/api/memory/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: map.project.id,
          targetId: selected.key,
          targetText: selected.value.text,
          note,
          reporter: me || null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      note = '';
      reporting = false;
      notice = 'Sent to the project leader.';
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not send this report';
    } finally {
      busy = '';
    }
  }
  async function closeReport(id: string) {
    await fetch(`/api/memory/reports/${id}`, { method: 'DELETE' });
    await invalidateAll();
  }
</script>

{#snippet check(e: Entry)}
  {#if e.value.kind === 'commitment' && e.state === 'accepted' && e.itemId}
    <input
      type="checkbox"
      class="check"
      checked={e.done}
      disabled={!canTick || busy === e.key}
      aria-label={`Completed: ${e.value.text}`}
      onchange={(event) => tick(e, event.currentTarget)}
    />
  {:else}<span class="check"></span>{/if}
{/snippet}

<svelte:head><title>Memory | Chronicler</title></svelte:head>

<div class="heading">
  <div>
    <h1>Memory</h1>
    {#if map}<p class="muted">{map.project.title}</p>{/if}
  </div>
  {#if !viewer}
    <div class="roles" role="group" aria-label="View as">
      {#each ['leader', 'student'] as const as r}
        <button
          aria-pressed={role === r}
          onclick={() => {
            chosenRole = r;
            remember('chronicler-memory-role', r);
          }}>{r === 'leader' ? 'Leader' : 'Student'}</button
        >
      {/each}
    </div>
  {/if}
</div>

{#if data.projects.length > 1}
  <div class="projects" aria-label="Project">
    {#each data.projects as p (p.id)}
      <a
        class="project"
        href={`/memory/map?project=${p.id}`}
        aria-current={map?.project.id === p.id ? 'page' : undefined}
        data-sveltekit-noscroll
      >
        <span class="thumb"
          >{#if p.picture}<img
              src={`/api/assets/${p.picture}`}
              alt=""
              decoding="async"
            />{:else}<Icon name="folder" size={20} />{/if}</span
        >
        <span class="name"
          ><strong>{p.title}</strong><span class="muted"
            >{p.meetings} meeting{p.meetings === 1 ? '' : 's'}{#if p.toReview}
              · <span class="to-review">{p.toReview} to review</span>{/if}</span
          ></span
        >
      </a>
    {/each}
  </div>
{/if}

{#if !map}
  <section class="card empty">
    <strong>No project memory yet</strong>
    <p class="muted">Add meetings to a project to see its memory here.</p>
    <a href="/sources">Go to Sources</a>
  </section>
{:else}
  <div class="stats">
    <span><strong>{map.meetings.length}</strong> meetings</span>
    <span><strong>{accepted.length}</strong> {role === 'leader' ? 'accepted' : 'confirmed'}</span>
    {#if pending.length}<span class="waiting"
        ><strong>{pending.length}</strong>
        {role === 'leader' ? 'to review' : 'not confirmed yet'}</span
      >{/if}
    {#if replaced.length}<span class="old"
        ><strong>{replaced.length}</strong> replaced</span
      >{/if}
    {#if role === 'student' && people.length}
      <label class="person"
        ><span class="muted">Viewing as</span><select
          value={me}
          onchange={(e) => {
            me = e.currentTarget.value;
            remember('chronicler-memory-person', me);
          }}
          ><option value="">Everyone</option>{#each people as p}<option value={p}
              >{p}</option
            >{/each}</select
        ></label
      >
    {/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <div class="layout">
    <div class="main">
      {#if role === 'student'}
        <div class="for-you">
          <section class="card">
            <h2>{me ? 'Your tasks' : 'Tasks'}</h2>
            {#each tasks as e (e.key)}
              <div class="task" class:done={e.done}>
              {@render check(e)}
              <button class="row" onclick={() => (selectedKey = e.key)}>
                <span class="row-text">{e.value.text}</span>
                <span class="row-meta"
                  >{#if !me}{e.value.owner ?? 'No owner'} ·
                  {/if}{e.value.deadline
                    ? `Due ${shortDate(e.value.deadline)}`
                    : 'No date'}{#if e.state === 'pending'}
                    · <span class="to-review">not confirmed yet</span
                    >{:else if e.value.status}
                    · {statusNames[e.value.status]}{/if}</span
                >
              </button>
              </div>
            {:else}
              <p class="muted none">
                {me ? 'Nothing assigned to you.' : 'No tasks yet.'}
              </p>
            {/each}
          </section>
          <section class="card">
            <h2>From the latest meeting</h2>
            {#if recent}
              {#each recent.items.slice(0, 4) as e (e.key)}
                <button class="row" onclick={() => (selectedKey = e.key)}>
                  <span class="row-text">{e.value.text}</span>
                  {#if e.was}<span class="row-meta was">{e.was}</span>{/if}
                </button>
              {/each}
            {:else}
              <p class="muted none">Nothing confirmed yet.</p>
            {/if}
            {#if !viewer && !data.readOnly}
              <button
                class="prepare"
                onclick={() =>
                  askInPanel(nextMeetingQuestion, map.project.id)}
                >Prepare for the next meeting</button
              >
            {/if}
          </section>
        </div>
      {/if}

      <section class="card">
        <div class="card-head">
          <h2>Map</h2>
          <div class="legend" aria-hidden="true">
            <span><i class="key accepted"></i>{role === 'leader' ? 'Accepted' : 'Confirmed'}</span>
            <span><i class="key pending"></i>{role === 'leader' ? 'To review' : 'Not confirmed yet'}</span>
            <span><i class="key replaced"></i>Replaced</span>
            {#if role === 'student' && me}<span><i class="key mine"></i>Yours</span>{/if}
          </div>
        </div>
        <div class="map">
          {#each map.meetings as m, index (m.revisionId)}
            <div class="col">
              <div class="rail" aria-hidden="true">
                <span class="dot"></span>{#if index < map.meetings.length - 1}<span
                    class="line"
                  ></span>{/if}
              </div>
              <a class="meeting" href={`/meeting/${m.revisionId}`}
                ><strong>{m.name}</strong><span class="muted"
                  >{shortDate(m.date)}</span
                ></a
              >
              {#each entries.filter((e) => e.meeting === m.revisionId) as e (e.key)}
                <button
                  class={`chip ${e.state}`}
                  class:mine={role === 'student' &&
                    !!me &&
                    e.value.owner === me}
                  aria-pressed={selected?.key === e.key}
                  onclick={() => (selectedKey = e.key)}
                >
                  <span class="chip-kind"
                    >{kindName(e)}{e.value.owner
                      ? ` · ${e.value.owner}`
                      : ''}</span
                  >
                  <span class="chip-text">{e.value.text}</span>
                </button>
              {/each}
              {#if m.topics.length}
                <details class="topics">
                  <summary
                    >{m.topics.length} topic{m.topics.length === 1
                      ? ''
                      : 's'}</summary
                  >
                  {#each m.topics as t (t.id)}<a href={`/memory/nodes/${t.id}`}
                      >{t.title}</a
                    >{/each}
                </details>
              {/if}
            </div>
          {/each}
        </div>
        {#if !entries.length}
          <p class="muted hint">
            No decisions or tasks yet. <a
              href={`/changes?project=${map.project.id}`}>Compare two meetings</a
            > to find them.
          </p>
        {/if}
      </section>

      {#if role === 'leader' && map.reports.length}
        <section class="card">
          <h2>Reported mistakes</h2>
          {#each map.reports as r (r.id)}
            <div class="review-row">
              <button class="row" onclick={() => (selectedKey = r.targetId)}>
                <span class="row-text">{r.note}</span>
                <span class="row-meta"
                  >{r.reporter ?? 'A reader'} · on “{r.targetText}”</span
                >
              </button>
              {#if canReview}<button
                  class="secondary"
                  onclick={() => closeReport(r.id)}>Done</button
                >{/if}
            </div>
          {/each}
        </section>
      {/if}

      {#if role === 'leader' && pending.length}
        <section class="card">
          <div class="card-head">
            <h2>To review</h2>
            {#if canReview && pending.length > 1}<button
                disabled={!!busy}
                onclick={() => act(pending, 'approve')}
                >{busy === 'all'
                  ? 'Accepting…'
                  : `Accept all ${pending.length}`}</button
              >{/if}
          </div>
          {#each pending as e (e.key)}
            <div class="review-row">
              <button class="row" onclick={() => (selectedKey = e.key)}>
                <span class="row-kind">{kindName(e)}</span>
                <span class="row-text">{e.value.text}</span>
                <span class="row-meta"
                  >{meetingName(e.meeting)}{e.value.owner
                    ? ` · ${e.value.owner}`
                    : ''}{e.value.deadline
                    ? ` · due ${shortDate(e.value.deadline)}`
                    : ''}</span
                >
              </button>
              {#if canReview}
                <div class="actions">
                  <button
                    class="secondary strong"
                    disabled={!!busy}
                    onclick={() => act([e], 'approve')}>Accept</button
                  >
                  <a class="button-link secondary" href={`/changes/${e.comparisonId}`}
                    >Edit</a
                  >
                  <button
                    class="secondary danger"
                    disabled={!!busy}
                    onclick={() => act([e], 'reject')}>Reject</button
                  >
                </div>
              {/if}
            </div>
          {/each}
        </section>
      {/if}

      {#if accepted.length || loose.length}
        <section class="card">
          <div class="card-head">
            <h2>{role === 'leader' ? 'Accepted' : 'Confirmed'}</h2>
            <div class="filters" role="group" aria-label="Show">
              {#each [['all', 'All'], ['decision', 'Decisions'], ['commitment', 'Tasks']] as const as [value, name]}
                <button
                  aria-pressed={filter === value}
                  onclick={() => (filter = value)}
                  >{name}
                  {accepted.filter(
                    (e) => value === 'all' || e.value.kind === value,
                  ).length}</button
                >
              {/each}
            </div>
          </div>
          {#each listed as e (e.key)}
            <div
              class="task"
              class:current={selected?.key === e.key}
              class:done={e.done}
            >
              {@render check(e)}
              <button class="row" onclick={() => (selectedKey = e.key)}>
                <span class="cols">
                  <span class="row-kind">{kindName(e)}</span>
                  <span class="row-text">{e.value.text}</span>
                  <span class="row-meta">{meetingName(e.meeting)}</span>
                </span>
              </button>
            </div>
          {:else}
            <p class="muted none">None yet.</p>
          {/each}
        </section>
      {/if}
    </div>

    {#if selected}
      <aside class="card detail" aria-label="Selected item">
        <div>
          <div class="tags">
            <span class="row-kind">{kindName(selected)}</span>
            <span class={`tag ${selected.state}`}
              >{selected.state === 'accepted'
                ? role === 'leader'
                  ? 'Accepted'
                  : 'Confirmed'
                : selected.state === 'pending'
                  ? role === 'leader'
                    ? 'To review'
                    : 'Not confirmed yet'
                  : 'Replaced'}</span
            >
          </div>
          <h2 class="title">{selected.value.text}</h2>
          <p class="muted meta">
            {meetingName(selected.meeting)}{selected.value.owner
              ? ` · ${selected.value.owner}`
              : ''}{selected.value.deadline
              ? ` · due ${shortDate(selected.value.deadline)}`
              : ''}{selected.value.status
              ? ` · ${statusNames[selected.value.status]}`
              : ''}
          </p>
        </div>

        {#if selected.evidence.length}
          <div>
            <h3>Evidence</h3>
            {#each selected.evidence as c}
              <blockquote>
                <p>{c.quote}</p>
                <a href={c.url}>{c.filename}</a>
              </blockquote>
            {/each}
          </div>
        {/if}

        {#if previous || selected.was}
          <div>
            <h3>Replaces</h3>
            <p class="was">{previous?.value.text ?? selected.was}</p>
          </div>
        {/if}

        {#if role === 'leader' && history.length}
          <div>
            <h3>History</h3>
            {#each history as h (h.key)}
              <p class="step">
                <span class="muted">{shortDate(h.createdAt)}</span>
                <span
                  >{h.edited ? 'Edited and accepted' : 'Accepted'} from {meetingName(
                    h.meeting,
                  ) || 'a meeting'}</span
                >
              </p>
            {/each}
            {#if selected.eventId}<a href={`/changes/reviews/${selected.eventId}`}
                >Full review record</a
              >{/if}
          </div>
        {/if}

        {#if selected.state === 'pending' && selected.why && role === 'leader'}
          <p class="muted why">{selected.why}</p>
        {/if}

        <div class="actions">
          {#if canReview && selected.state === 'pending'}
            <button disabled={!!busy} onclick={() => act([selected], 'approve')}
              >Accept</button
            >
            <a
              class="button-link secondary"
              href={`/changes/${selected.comparisonId}`}>Edit</a
            >
            <button
              class="secondary danger"
              disabled={!!busy}
              onclick={() => act([selected], 'reject')}>Reject</button
            >
          {/if}
          {#if !viewer && !data.readOnly}
            <button
              class="secondary"
              onclick={() =>
                askInPanel(
                  `Explain this ${kindName(selected).toLowerCase()} and the evidence behind it: "${selected.value.text}"`,
                  map.project.id,
                )}>Ask about this</button
            >
          {/if}
          {#if role === 'student' && !data.readOnly}
            <button class="secondary" onclick={() => (reporting = !reporting)}
              >Report a mistake</button
            >
          {/if}
        </div>
        {#if reporting && role === 'student'}
          <div class="report">
            <label
              >What looks wrong?<textarea rows="3" bind:value={note}
              ></textarea></label
            >
            <button disabled={!note.trim() || !!busy} onclick={report}
              >Send to leader</button
            >
          </div>
        {/if}
        {#if notice}<p class="muted" role="status">{notice}</p>{/if}
      </aside>
    {/if}
  </div>
{/if}

<style>
  .heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.4rem;
  }
  h1 {
    font-size: 1.9rem;
    margin: 0 0 0.2rem;
  }
  .heading p {
    margin: 0;
  }
  h2 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.6rem;
  }
  h3 {
    font-size: 0.8rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }
  .roles,
  .filters {
    display: inline-flex;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-soft);
  }
  .roles button,
  .filters button {
    background: transparent;
    color: var(--muted);
    padding: 0.4rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 400;
    border-radius: 6px;
  }
  .roles button:hover,
  .filters button:hover {
    background: var(--canvas);
    color: var(--ink);
  }
  .roles button[aria-pressed='true'],
  .filters button[aria-pressed='true'] {
    background: var(--ink);
    color: white;
    font-weight: 500;
  }
  .projects {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    gap: 0.7rem;
    margin-bottom: 1.4rem;
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
    min-width: 0;
  }
  .project:hover {
    text-decoration: none;
    border-color: var(--muted);
  }
  .project[aria-current='page'] {
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
  .stats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1.2rem;
    font-size: 0.85rem;
  }
  .stats > span {
    padding: 0.35rem 0.8rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--muted);
  }
  .stats strong {
    color: var(--ink);
  }
  .stats .waiting {
    background: var(--yellow-soft);
    border-color: transparent;
    color: var(--yellow-ink);
  }
  .stats .waiting strong {
    color: inherit;
  }
  .stats .old {
    border-style: dashed;
  }
  .person {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }
  .person select {
    padding: 0.35rem 0.6rem;
    font-size: 0.85rem;
  }
  .layout {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 1.2rem;
  }
  .main {
    flex: 999 1 34rem;
    min-width: 0;
    display: grid;
    gap: 1.2rem;
  }
  .main > *,
  .for-you > * {
    margin: 0;
    min-width: 0;
  }
  .for-you {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
    gap: 1.2rem;
  }
  .card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem 1rem;
    margin-bottom: 0.8rem;
  }
  .card-head h2 {
    margin: 0;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.9rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .key {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 3px;
    border: 1.5px solid var(--ink);
    background: var(--surface);
  }
  .key.pending {
    background: var(--yellow-soft);
    border-color: #b98d2b;
  }
  .key.replaced {
    border-style: dashed;
    border-color: #9a9a93;
  }
  .key.mine {
    background: var(--ink);
  }
  .map {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(12.5rem, 1fr);
    overflow-x: auto;
    padding: 2px 2px 0.6rem;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding-right: 0.8rem;
    min-width: 0;
  }
  .rail {
    display: flex;
    align-items: center;
    height: 0.8rem;
    margin-right: -0.8rem;
  }
  .dot {
    flex: none;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--ink);
  }
  .line {
    flex: 1;
    height: 2px;
    background: #d9d8d3;
  }
  .meeting {
    display: grid;
    color: var(--ink);
    font-size: 0.85rem;
    margin-bottom: 0.2rem;
    overflow-wrap: anywhere;
  }
  .meeting strong {
    font-weight: 600;
  }
  .meeting .muted {
    font-size: 0.75rem;
  }
  .chip {
    display: grid;
    gap: 0.1rem;
    width: 100%;
    padding: 0.5rem 0.65rem;
    background: var(--surface);
    color: var(--ink);
    border: 1.5px solid var(--ink);
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 400;
    line-height: 1.4;
  }
  .chip:hover {
    background: var(--canvas);
  }
  .chip-kind {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--muted);
  }
  .chip-text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .chip.pending {
    background: var(--yellow-soft);
    border-color: #b98d2b;
  }
  .chip.pending .chip-kind {
    color: var(--yellow-ink);
  }
  .chip.replaced {
    border-style: dashed;
    border-color: #9a9a93;
    color: var(--muted);
  }
  .chip.replaced .chip-text {
    text-decoration: line-through;
  }
  .chip.mine {
    box-shadow: inset 4px 0 0 var(--ink);
    padding-left: 0.85rem;
  }
  .chip[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--blue-soft);
    box-shadow: 0 0 0 3px #c9dcf6;
  }
  .chip[aria-pressed='true'] .chip-kind {
    color: var(--blue-ink);
  }
  .topics {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .topics summary {
    cursor: pointer;
    padding: 0.2rem 0;
  }
  .topics a {
    display: block;
    padding: 0.2rem 0;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .hint {
    margin: 0.8rem 0 0;
  }
  .row {
    display: block;
    width: 100%;
    padding: 0.7rem 0.4rem;
    background: transparent;
    color: var(--ink);
    border: 0;
    border-top: 1px solid var(--border);
    border-radius: 0;
    font-weight: 400;
    min-width: 0;
  }
  .row:hover {
    background: var(--surface-soft);
  }
  /* Spans stack inside the button; the button itself stays a plain block so
     it always grows with wrapped text. */
  .row > span {
    display: block;
  }
  .row > span + span {
    margin-top: 0.1rem;
  }
  .row > .cols {
    display: grid;
    grid-template-columns: 5rem minmax(0, 1fr) minmax(0, auto);
    align-items: baseline;
    gap: 0.8rem;
  }
  .task {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding-left: 0.4rem;
    border-top: 1px solid var(--border);
    transition: opacity 200ms;
  }
  .task .row {
    flex: 1;
    border-top: 0;
  }
  .task.current {
    background: var(--blue-soft);
  }
  .check {
    flex: none;
    width: 1rem;
    height: 1rem;
    margin: 0.85rem 0 0;
    accent-color: var(--ink);
  }
  input.check:not(:disabled) {
    cursor: pointer;
  }
  .task.done .row {
    opacity: 0.5;
  }
  .task.done .row-text {
    text-decoration: line-through;
  }
  .row-kind {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted);
  }
  .row-text {
    overflow-wrap: anywhere;
  }
  .row-meta {
    font-size: 0.78rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .row-meta.was,
  .was {
    color: var(--muted);
    text-decoration: line-through;
  }
  .none {
    margin: 0;
    padding: 0.6rem 0;
    border-top: 1px solid var(--border);
  }
  .prepare {
    margin-top: 0.8rem;
  }
  .review-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.8rem;
    border-top: 1px solid var(--border);
  }
  .review-row .row {
    flex: 1 1 16rem;
    width: auto;
    border-top: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .actions button,
  .actions a {
    padding: 0.5rem 0.9rem;
    font-size: 0.85rem;
  }
  .secondary.strong {
    border-color: var(--ink);
    font-weight: 500;
  }
  .secondary.danger {
    color: var(--red-ink);
  }
  .detail {
    flex: 1 1 19rem;
    min-width: 0;
    margin: 0;
    display: grid;
    gap: 1.1rem;
    position: sticky;
    top: 1rem;
  }
  .tags {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .tag {
    font-size: 0.75rem;
    padding: 0.05rem 0.55rem;
    border-radius: 999px;
    background: var(--blue-soft);
    color: var(--blue-ink);
  }
  .tag.pending {
    background: var(--yellow-soft);
    color: var(--yellow-ink);
  }
  .tag.replaced {
    background: var(--canvas);
    color: var(--muted);
  }
  .title {
    font-size: 1.15rem;
    line-height: 1.35;
    margin: 0.4rem 0 0.2rem;
    overflow-wrap: anywhere;
  }
  .meta,
  .why,
  .was {
    margin: 0;
    font-size: 0.82rem;
  }
  blockquote {
    margin: 0 0 0.6rem;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    background: var(--surface-soft);
    font-size: 0.82rem;
  }
  blockquote p {
    margin: 0 0 0.3rem;
    overflow-wrap: anywhere;
  }
  blockquote a {
    color: var(--muted);
    font-size: 0.75rem;
  }
  .step {
    display: flex;
    gap: 0.7rem;
    margin: 0 0 0.3rem;
    font-size: 0.82rem;
  }
  .step .muted {
    flex: 0 0 3.6rem;
  }
  .report {
    display: grid;
    gap: 0.6rem;
    justify-items: start;
  }
  .report label {
    display: grid;
    gap: 0.35rem;
    width: 100%;
    font-size: 0.82rem;
  }
  .report textarea {
    width: 100%;
  }
  .empty {
    display: grid;
    gap: 0.4rem;
    justify-items: start;
  }
  .empty p {
    margin: 0;
  }
  @media (max-width: 650px) {
    .heading {
      flex-direction: column;
      align-items: stretch;
    }
    .row > .cols {
      grid-template-columns: 1fr;
      gap: 0.1rem;
    }
    .detail {
      position: static;
    }
  }
</style>
