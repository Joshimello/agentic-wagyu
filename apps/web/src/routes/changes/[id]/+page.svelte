<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { shortDate } from '../../../lib/dates';
  import Icon from '../../../lib/components/Icon.svelte';
  import ChangeProposalReview from '../../../lib/components/ChangeProposalReview.svelte';
  let { data } = $props();
  let error = $state(''),
    busy = $state(false);
  let reviewed = $derived(data.proposals.filter((p) => p.review).length);
  let pending = $derived(['queued', 'processing'].includes(data.job.state));
  onMount(() => {
    const timer = setInterval(() => {
      if (pending) void invalidateAll();
    }, 1500);
    return () => clearInterval(timer);
  });
  async function action(action: 'cancel' | 'retry') {
    busy = true;
    error = '';
    try {
      const r = await fetch(`/api/comparisons/${data.job.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ generation: data.job.generation }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Action failed';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Review meeting changes | Chronicler</title></svelte:head>
<a class="back" href="/changes"
  ><Icon name="arrow-left" size={14} />Changes</a
>
<h1>Review changes</h1>
<div class="pair">
  <span
    ><strong>{data.job.scope.earlier.filename}</strong><small
      >{shortDate(data.job.scope.earlier.date)}</small
    ></span
  >
  <Icon name="arrow-right" size={18} />
  <span
    ><strong>{data.job.scope.later.filename}</strong><small
      >{shortDate(data.job.scope.later.date)}</small
    ></span
  >
</div>
{#if pending}<section class="card">
    <p aria-live="polite">{data.job.progress}</p>
    <button class="secondary" disabled={busy} onclick={() => action('cancel')}
      >Cancel comparison</button
    >
  </section>{/if}
{#if data.job.error}<p class="error">{data.job.error}</p>{/if}
{#if ['failed', 'canceled'].includes(data.job.state)}<button
    disabled={busy}
    onclick={() => action('retry')}
    >Retry with the same evidence and baseline</button
  >{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if data.job.warnings.length}<details class="notes">
    <summary>{data.job.warnings.length} notes from the comparison</summary>
    <ul>
      {#each data.job.warnings as warning}<li>{warning}</li>{/each}
    </ul>
  </details>{/if}
{#if data.job.state === 'completed'}
  {#if data.proposals.length}<div class="progress">
      <span
        ><strong>{reviewed} of {data.proposals.length}</strong> reviewed</span
      >
      <span class="track" aria-hidden="true"
        ><span
          style:width={`${(reviewed / data.proposals.length) * 100}%`}
        ></span></span
      >
      <span class="muted">Nothing is saved to the project until you approve it.</span>
    </div>{/if}
  {#if !data.proposals.length}<section class="card">
      No supported new or changed decisions or commitments were established.
    </section>{/if}{/if}
{#each data.proposals as p (p.id)}<ChangeProposalReview
    proposalId={p.id}
    proposal={p.proposal}
    scope={data.job.scope}
    review={p.review}
    onreviewed={invalidateAll}
  />{/each}

<style>
  h1 {
    font-size: 28px;
    margin: 12px 0 10px;
  }
  p {
    margin: 16px 0;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .pair {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    margin: 0 0 1.4rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .pair span {
    display: grid;
  }
  .pair strong {
    color: var(--ink);
    font-weight: 500;
  }
  .pair small {
    font-size: 0.78rem;
  }
  .progress {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin: 0 0 1.2rem;
    font-size: 0.85rem;
  }
  .track {
    flex: 0 1 12rem;
    height: 6px;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
  }
  .track span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 300ms var(--ease-out);
  }
  ul {
    margin: 20px 0;
    padding-left: 20px;
  }
  .notes {
    margin: 16px 0;
    color: var(--muted);
    font-size: 0.88rem;
  }
  .notes summary {
    cursor: pointer;
  }
</style>
