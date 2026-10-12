<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import ChangeProposalReview from '../../../lib/components/ChangeProposalReview.svelte';
  let { data } = $props();
  let error = $state(''),
    busy = $state(false);
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
<a href="/changes">Back to What changed?</a>
<h1>Review meeting changes</h1>
<p class="muted">
  Memory snapshot {data.job.scope.memoryVersion} - approved-state baseline {data
    .job.scope.reviewVersion}
</p>
<div class="pair card">
  <p>
    <strong>Earlier</strong><br />{data.job.scope.earlier.filename}<br /><span
      >{data.job.scope.earlier.date ?? 'Unknown date'}</span
    >
  </p>
  <p>
    <strong>Later</strong><br />{data.job.scope.later.filename}<br /><span
      >{data.job.scope.later.date ?? 'Unknown date'}</span
    >
  </p>
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
{#if data.job.warnings.length}<ul>
    {#each data.job.warnings as warning}<li>{warning}</li>{/each}
  </ul>{/if}
{#if data.job.state === 'completed'}<p>
    Proposals remain pending until you approve them. Approval updates reviewed
    project state and Ask; it does not push staging evidence.
  </p>
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
    margin: 20px 0;
  }
  p {
    margin: 16px 0;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin: 20px 0;
    overflow-wrap: anywhere;
  }
  ul {
    margin: 20px 0;
    padding-left: 20px;
  }
  @media (max-width: 650px) {
    .pair {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
</style>
