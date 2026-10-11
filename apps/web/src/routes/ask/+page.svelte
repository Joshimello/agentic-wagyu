<script lang="ts">
  import { goto } from '$app/navigation';
  let { data } = $props();
  let question = $state(''),
    projectId = $state(''),
    knownVersion = $state(''),
    effectiveAt = $state(''),
    busy = $state(false),
    error = $state('');
  async function ask(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          idempotencyKey: crypto.randomUUID(),
          ...(projectId ? { projectId } : {}),
          ...(knownVersion ? { knownVersion: Number(knownVersion) } : {}),
          ...(effectiveAt ? { effectiveAt } : {}),
        }),
      });
      const run = await response.json();
      if (!response.ok) throw new Error(run.error);
      await goto(`/ask/${run.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not ask';
      busy = false;
    }
  }
</script>

<h1>Ask your research memory</h1>
<p class="muted">
  Explore summaries, inspect original evidence, and get cited answers. Only
  pushed files are included.
</p>
<form class="card" onsubmit={ask}>
  <label
    >Question<textarea
      bind:value={question}
      required
      maxlength="4000"
      rows="4"
      placeholder="What changed in our approach across the weekly meetings?"
    ></textarea></label
  >
  <div class="scope">
    <label
      >Project<select bind:value={projectId}
        ><option value="">All projects</option>{#each data.projects as p}<option
            value={p.id}>{p.title}</option
          >{/each}</select
      ></label
    >
    <label
      >Memory snapshot<select bind:value={knownVersion}
        ><option value="">Latest at query start ({data.version})</option
        >{#each [...data.commits].reverse() as c}<option
            value={String(c.version)}>Snapshot {c.version}</option
          >{/each}</select
      ></label
    >
  </div>
  <details>
    <summary>Event-date filter</summary><label
      >Include sources dated on or before<input
        type="date"
        bind:value={effectiveAt}
      /></label
    >
    <p class="muted">
      Unknown dates are excluded. File-derived dates remain tentative. A memory
      snapshot filters when evidence was accepted; this filters the source date.
    </p>
  </details>
  {#if error}<p class="error">{error}</p>{/if}
  <button disabled={busy || !question.trim()}
    >{busy ? 'Starting…' : 'Ask Researcher'}</button
  >
</form>
<h2>Previous questions</h2>
{#each data.runs as run}<article class="card previous">
    <a href={`/ask/${run.id}`}>{run.question}</a>
    <p class="muted">{run.state} · Snapshot {run.scope.version}</p>
  </article>{:else}<p class="muted">
    Your saved answers will appear here.
  </p>{/each}

<style>
  form {
    display: grid;
    gap: 20px;
    margin: 24px 0 32px;
  }
  .scope {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  select {
    font: inherit;
    padding: 10px;
    border: 1px solid #ccd6e2;
    border-radius: 6px;
    background: white;
    max-width: 100%;
  }
  textarea {
    width: 100%;
  }
  .previous {
    margin: 12px 0;
  }
  details label {
    margin: 14px 0;
  }
  button {
    justify-self: start;
  }
  @media (max-width: 700px) {
    .scope {
      grid-template-columns: 1fr;
    }
  }
</style>
