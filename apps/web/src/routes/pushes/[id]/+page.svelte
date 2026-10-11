<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Icon from '../../../lib/components/Icon.svelte';
  import Disclosure from '../../../lib/components/Disclosure.svelte';
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
  async function retry(action = 'retry') {
    const response = await fetch(`/api/pushes/${push.id}/${action}`, {
      method: 'POST',
    });
    if (response.ok) {
      push = await response.json();
      error = '';
    } else error = (await response.json()).error;
  }
</script>

<a class="button-link" href="/"><Icon name="arrow-left" size={16} />Staging</a>
<h1>Push to memory</h1>
<section class="card">
  <span class="badge">{push.state}</span>
  <p>{push.progress}</p>
  {#if push.commitVersion !== null}<p>
      Memory version {push.commitVersion} ·
      <a
        href={`/memory${push.input.workflow === 'summary' ? '' : '/assertions'}?knownVersion=${push.commitVersion}`}
        >View accepted graph</a
      >
    </p>{/if}
  {#if push.error}<p class="error">{push.error}</p>{/if}{#if error}<p
      class="error"
    >
      {error}
    </p>{/if}
  {#if ['failed', 'canceled'].includes(push.state)}<button
      onclick={() => retry()}>Retry pinned push</button
    >{/if}
  {#if ['queued', 'processing'].includes(push.state)}<button
      onclick={() => retry('cancel')}>Cancel push</button
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
        · {outcome.disposition.replaceAll('_', ' ')} · {outcome.segments !==
        undefined
          ? `${outcome.segments} segments`
          : `${outcome.assertions} assertions`}{#if outcome.warnings.length}<Disclosure
            title={`${outcome.warnings.length} processing notes`}
            icon="warning"
          >
            <ul>
              {#each outcome.warnings as warning}<li>{warning}</li>{/each}
            </ul>
          </Disclosure>{/if}
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
