<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Icon from '../../../lib/components/Icon.svelte';
  import Disclosure from '../../../lib/components/Disclosure.svelte';
  import ProgressBar from '../../../lib/components/ProgressBar.svelte';
  let { data } = $props();
  let push = $state(untrack(() => data.push));
  let error = $state('');
  let changing = $state(false);
  let requestVersion = 0;
  let active = $derived(['queued', 'processing'].includes(push.state));
  $effect(() => {
    ++requestVersion;
    push = data.push;
  });
  onMount(() => {
    let fetching = false;
    let disposed = false;
    const timer = setInterval(async () => {
      if (
        fetching ||
        changing ||
        !['queued', 'processing'].includes(push.state)
      )
        return;
      fetching = true;
      const id = push.id;
      const version = requestVersion;
      try {
        const response = await fetch(`/api/pushes/${id}`);
        const result = await response.json();
        if (
          response.ok &&
          !disposed &&
          id === data.push.id &&
          version === requestVersion &&
          !changing
        )
          push = result;
      } catch {
      } finally {
        fetching = false;
      }
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  });
  async function retry() {
    if (changing) return;
    ++requestVersion;
    changing = true;
    error = '';
    const id = push.id;
    try {
      const response = await fetch(`/api/pushes/${id}/retry`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not retry this push');
      if (id === data.push.id) push = result;
    } catch (e) {
      if (id === data.push.id)
        error = e instanceof Error ? e.message : 'Could not retry this push';
    } finally {
      changing = false;
    }
  }
  async function cancel() {
    if (!active || changing) return;
    ++requestVersion;
    changing = true;
    error = '';
    const id = push.id;
    try {
      const response = await fetch(`/api/pushes/${id}/cancel`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not cancel this push');
      if (id === data.push.id) push = result;
    } catch (e) {
      if (id === data.push.id)
        error = e instanceof Error ? e.message : 'Could not cancel this push';
    } finally {
      changing = false;
    }
  }
</script>

<a class="button-link" href="/"><Icon name="arrow-left" size={16} />Staging</a>
<h1>Push to memory</h1>
<section class="card">
  <span class="badge">{push.state}</span>
  <div class="push-progress">
    <ProgressBar
      value={push.progressPercent ?? 0}
      label={push.progress}
      state={push.state}
    />{#if active}<button class="secondary" disabled={changing} onclick={cancel}
        ><Icon name="close" />{changing ? 'Stopping...' : 'Cancel'}</button
      >{/if}
  </div>
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
      disabled={changing}
      onclick={retry}><Icon name="refresh" />Retry pinned push</button
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
  .push-progress {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin: 1.2rem 0;
  }
  .push-progress :global(.progress-bar) {
    flex: 1;
    min-width: 0;
  }
  .push-progress button {
    flex-shrink: 0;
  }
  h1 {
    margin: 16px 0;
  }
  article {
    border-top: 1px solid #edf0f4;
    padding: 12px 0;
  }
</style>
