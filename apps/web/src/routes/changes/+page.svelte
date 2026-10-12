<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  let { data } = $props();
  let projectId = $state(untrack(() => data.choices.projects[0]?.id ?? '')),
    earlier = $state(''),
    later = $state('');
  let busy = $state(false),
    error = $state('');
  let meetings = $derived(
    data.choices.projects.find((p) => p.id === projectId)?.meetings ?? [],
  );
  let approved = $derived(
    data.approved.filter((v) => v.projectId === projectId),
  );
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

<svelte:head><title>What changed? | Chronicler</title></svelte:head>
<div class="heading">
  <div>
    <h1>What changed?</h1>
    <p class="muted">
      Review decisions and commitments across meetings. Approved changes become
      available in Ask.
    </p>
  </div>
  <a href="/memory">Open research memory</a>
</div>
<section class="card selection">
  <h2>Choose a meeting pair</h2>
  <p>
    Choose the order yourself. Unknown dates stay unknown; only admitted
    meetings belonging to the accepted project appear here.
  </p>
  <label
    >Accepted project<select
      bind:value={projectId}
      onchange={() => {
        earlier = '';
        later = '';
      }}
      ><option value="">Select a project</option
      >{#each data.choices.projects as p}<option value={p.id}>{p.title}</option
        >{/each}</select
    ></label
  >
  <div class="pair">
    {#each ['Earlier', 'Later'] as side}<label
        >{side} meeting<select
          value={side === 'Earlier' ? earlier : later}
          onchange={(e) => {
            if (side === 'Earlier') earlier = e.currentTarget.value;
            else later = e.currentTarget.value;
          }}
          ><option value="">Select {side.toLowerCase()} meeting</option
          >{#each meetings as m}<option
              value={m.revisionId}
              disabled={m.revisionId === (side === 'Earlier' ? later : earlier)}
              >{m.label || m.filename} - {m.date ?? 'Unknown date'}</option
            >{/each}</select
        ></label
      >{/each}
  </div>
  {#if meetings.length < 2}<p class="muted">
      This project needs two different admitted meetings before comparison is
      available.
    </p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <button
    disabled={busy || !projectId || !earlier || !later || earlier === later}
    onclick={create}
    >{busy ? 'Creating comparison...' : 'Compare meetings'}</button
  >
</section>
{#if approved.length}<section class="card">
    <h2>Approved project state</h2>
    {#each approved as v}<article>
        <span class="badge"
          >{v.value.kind} {v.value.status?.replaceAll('_', ' ') ?? ''}</span
        >
        <p>{v.value.text}</p>
        <p class="muted">
          Owner: {v.value.owner ?? 'Unknown'} - Deadline: {v.value.deadline ??
            'Unknown'}
        </p>
        {#if v.reviewerAdded.length}<p class="muted">
            Reviewer additions: {v.reviewerAdded.join(', ')}
          </p>{/if}<a href={`/changes/reviews/${v.eventId}`}>Review history</a>
      </article>{/each}
  </section>{/if}
<section class="card">
  <h2>Saved comparisons</h2>
  {#if !data.comparisons.length}<p class="muted">
      No comparisons yet.
    </p>{/if}{#each data.comparisons as c}<article>
      <a href={`/changes/${c.id}`}
        >{data.choices.projects.find((p) => p.id === c.input.projectId)
          ?.title ?? 'Research project'}</a
      ><span class="badge">{c.state}</span><small
        >{new Date(c.createdAt).toLocaleString()}</small
      >
    </article>{/each}
</section>

<style>
  .heading {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 24px;
  }
  h1 {
    font-size: 30px;
  }
  h2 {
    font-size: 19px;
    margin-bottom: 12px;
  }
  .card {
    margin-bottom: 20px;
  }
  label {
    display: grid;
    gap: 8px;
    margin: 20px 0;
  }
  select {
    width: 100%;
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface, #fff);
    color: inherit;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  article {
    padding: 16px 0;
    border-top: 1px solid var(--border);
  }
  article p {
    margin: 8px 0;
  }
  small {
    display: block;
    color: #697586;
    margin-top: 8px;
  }
  .badge {
    margin-left: 8px;
  }
  @media (max-width: 650px) {
    .heading {
      display: block;
    }
    .pair {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
</style>
