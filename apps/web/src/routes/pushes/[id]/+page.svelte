<script lang="ts">
  import { onMount, untrack } from 'svelte';
  let { data } = $props();
  let push = $state(untrack(() => data.push));
  let error = $state('');
  onMount(() => {
    const timer = setInterval(async () => {
      const response = await fetch(`/api/pushes/${push.id}`);
      if (response.ok) push = await response.json();
    }, 2000);
    return () => clearInterval(timer);
  });
  async function retry() {
    const response = await fetch(`/api/pushes/${push.id}/retry`, {
      method: 'POST',
    });
    if (response.ok) {
      push = await response.json();
      error = '';
    } else error = (await response.json()).error;
  }
</script>

<a href="/">← Staging</a>
<h1>Push to memory</h1>
<section class="card">
  <span class="badge">{push.state}</span>
  <p>{push.progress}</p>
  {#if push.commitVersion !== null}<p>
      Memory version {push.commitVersion} ·
      <a href={`/memory?knownVersion=${push.commitVersion}`}
        >View accepted graph</a
      >
    </p>{/if}
  {#if push.error}<p class="error">{push.error}</p>{/if}{#if error}<p
      class="error"
    >
      {error}
    </p>{/if}
  {#if push.state === 'failed'}<button onclick={retry}>Retry pinned push</button
    >{/if}
  <h2>Selected evidence</h2>
  {#each push.input.items as item}<p>
      <a href={`/staging/${item.uploadId}?revision=${item.revisionId}`}
        >Revision {item.revisionId.slice(0, 8)}</a
      >{item.acceptPartial ? ' · Partial extraction accepted' : ''}
    </p>{/each}
  {#if push.outcomes.length}<h2>File outcomes</h2>
    {#each push.outcomes as outcome}<article>
        <a href={`/staging/${outcome.uploadId}?revision=${outcome.revisionId}`}
          >Source {outcome.revisionId.slice(0, 8)}</a
        >
        · {outcome.disposition.replaceAll('_', ' ')} · {outcome.assertions} assertions{#if outcome.warnings.length}<details
          >
            <summary>{outcome.warnings.length} processing notes</summary>
            <ul>
              {#each outcome.warnings as warning}<li>{warning}</li>{/each}
            </ul>
          </details>{/if}
      </article>{/each}{/if}
</section>

<style>
  h1 {
    margin: 16px 0;
  }
  article {
    border-top: 1px solid #edf0f4;
    padding: 12px 0;
  }
</style>
