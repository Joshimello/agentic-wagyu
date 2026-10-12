<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  let { data } = $props(),
    actionError = $state('');
  const pending = () => ['queued', 'processing'].includes(data.run.state);
  onMount(() => {
    const timer = setInterval(() => {
      if (pending()) void invalidateAll();
    }, 1500);
    return () => clearInterval(timer);
  });
  async function action(action: string) {
    actionError = '';
    try {
      const r = await fetch(`/api/research/${data.run.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      await invalidateAll();
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'Action failed';
    }
  }
</script>

<a href="/ask">← Questions</a>
<h1>{data.run.input.question}</h1>
<p class="muted">
  <a href={`/memory?knownVersion=${data.run.scope.version}`}
    >Memory snapshot {data.run.scope.version}</a
  >
  · {data.run.state}{data.run.scope.effectiveAt
    ? ` · Source date ≤ ${data.run.scope.effectiveAt}`
    : ''}
</p>
{#if pending()}<section class="card">
    <p aria-live="polite">{data.run.progress}</p>
    <button class="secondary" onclick={() => action('cancel')}
      >Cancel question</button
    >
  </section>{/if}
{#if data.run.error}<p class="error">{data.run.error}</p>{/if}
{#if ['failed', 'canceled'].includes(data.run.state)}<button
    onclick={() => action('retry')}>Retry with the same snapshot</button
  >{/if}
{#if actionError}<p class="error">{actionError}</p>{/if}
{#if data.run.answer}
  <section class="card answer">
    <span class="badge">{data.run.answer.status.replaceAll('_', ' ')}</span>
    {#each data.run.answer.claims as claim, i}<article>
        <span class="basis"
          >{claim.basis === 'source'
            ? 'Source report'
            : claim.basis === 'inference'
              ? 'Inference'
              : claim.basis === 'reviewed'
                ? 'Reviewed state'
                : 'Conflicting evidence'}</span
        >
        <p>{claim.text}</p>
        <nav aria-label={`Sources for claim ${i + 1}`}>
          {#each claim.reviewRefs ?? [] as id}{@const review =
              data.run.answer.reviewReferences?.find(
                (r) => r.id === id,
              )}{#if review}<a href={review.url}
                >Approved review {review.reviewVersion}</a
              >{#if review.reviewerAdded.length}<span
                  >Reviewer additions: {review.reviewerAdded.join(', ')}</span
                >{/if}{/if}{/each}
          {#each claim.citations as id}{@const citation =
              data.run.answer.citations.find(
                (c) => c.id === id,
              )}{#if citation}<a href={citation.url}
                >{citation.filename} · {citation.locator.kind === 'slide'
                  ? `Slide ${citation.locator.slide}`
                  : citation.locator.kind === 'page'
                    ? `Page ${citation.locator.page}`
                    : citation.locator.kind === 'media'
                      ? `${Math.floor(citation.locator.startMs / 60000)}:${String(Math.floor(citation.locator.startMs / 1000) % 60).padStart(2, '0')}`
                      : 'Text'}{citation.historical
                  ? ' · Earlier evidence'
                  : ''}</a
              >{/if}{/each}
        </nav>
      </article>{/each}
    {#if data.run.answer.limitations.length}<h2>
        Missing evidence and limitations
      </h2>
      <ul>
        {#each data.run.answer.limitations as limitation}<li>
            {limitation}
          </li>{/each}
      </ul>{/if}
  </section>
  <details class="card notes">
    <summary>Evidence excerpts and retrieval notes</summary
    >{#each data.run.answer.citations as c}<article>
        <a href={c.url}>{c.filename}</a>
        <p>{c.quote ?? 'Visual evidence inspected by Researcher'}</p>
      </article>{/each}
    <ul>
      {#each data.run.answer.reviewReferences ?? [] as review}<li>
          <a href={review.url}>Approved review {review.reviewVersion}</a
          >{#each review.evidence as evidence}<p>
              <a href={evidence.url}>{evidence.filename}</a>: {evidence.quote}
            </p>{/each}
        </li>{/each}
      {#each data.run.answer.warnings as warning}<li>{warning}</li>{/each}
    </ul>
  </details>
  <p class="muted">
    {data.run.model} · {data.run.promptVersion} · {Math.round(
      (data.run.usage?.elapsedMs ?? 0) / 1000,
    )} seconds · {data.run.usage?.calls ?? 0} model calls
  </p>
{/if}

<style>
  h1 {
    margin: 20px 0;
    font-size: 27px;
  }
  .answer {
    margin: 24px 0;
  }
  article {
    margin: 20px 0;
    padding-bottom: 16px;
    border-bottom: 1px solid #edf0f4;
  }
  article p {
    white-space: pre-wrap;
  }
  .basis {
    font-size: 12px;
    color: #66768b;
  }
  nav {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 13px;
  }
  .notes {
    margin: 22px 0;
  }
  .notes p {
    font-size: 13px;
  }
  h2 {
    margin-top: 24px;
  }
</style>
