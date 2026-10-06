<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  let { data } = $props();
  let uploads = $state(untrack(() => data.uploads));
  let selected = $state(untrack(() => data.selections));
  let pushing = $state(false),
    projectMode = $state('auto'),
    projectId = $state(''),
    projectName = $state('');
  async function pushSelection() {
    pushing = true;
    message = '';
    try {
      const response = await fetch('/api/pushes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          items: selected.map((s) => ({
            uploadId: s.uploadId,
            revisionId: s.revisionId,
            acceptPartial: s.acceptPartial,
          })),
          projectScope:
            projectMode === 'auto'
              ? { mode: 'auto' }
              : projectMode === 'existing'
                ? { mode: 'existing', projectId }
                : { mode: 'new', name: projectName },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await goto(`/pushes/${result.id}`);
    } catch (error) {
      message = error instanceof Error ? error.message : 'Push failed';
    } finally {
      pushing = false;
    }
  }
  let groups = $derived(
    Array.from(
      Map.groupBy(uploads, (file) => file.metadata.groupId ?? file.id),
      ([id, files]) => ({ id, files }),
    ),
  );
  async function changeSelection(
    file: (typeof uploads)[number],
    remove = false,
    acceptPartial = false,
    revisionId = file.currentRevisionId,
  ) {
    message = '';
    try {
      const r = await fetch('/api/selections', {
        method: remove ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          remove
            ? { uploadId: file.id }
            : { uploadId: file.id, revisionId, acceptPartial },
        ),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      selected = result;
    } catch (e) {
      message = e instanceof Error ? e.message : 'Selection failed';
    }
  }
  let busy = $state(false),
    message = $state('');
  $effect(() => {
    uploads = data.uploads;
    selected = data.selections;
  });
  onMount(() => {
    const timer = setInterval(async () => {
      try {
        const r = await fetch('/api/uploads');
        if (r.ok) uploads = await r.json();
        const selections = await fetch('/api/selections');
        if (selections.ok) selected = await selections.json();
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  });
  async function upload(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    message = '';
    const form = event.currentTarget as HTMLFormElement;
    try {
      const r = await fetch('/api/uploads', {
        method: 'POST',
        body: new FormData(form),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      form.reset();
      uploads = await (await fetch('/api/uploads')).json();
    } catch (e) {
      message = e instanceof Error ? e.message : 'Upload failed';
    } finally {
      busy = false;
    }
  }
</script>

<div class="intro">
  <div>
    <h1>Your evidence, ready for review.</h1>
    <p class="muted">
      Upload source files. Interpreter prepares them in staging.
    </p>
  </div>
  <div class="memory">
    <strong>{data.memoryCount}</strong><span>memory commits</span>
  </div>
</div>
<section class="card">
  <h2>Add source files</h2>
  <form onsubmit={upload}>
    <label class="file"
      >Source files<input required name="file" type="file" multiple /></label
    ><label>Uploaded by<input name="uploader" value="local" /></label><label
      >Group / project hint (optional)<input
        name="groupHint"
        placeholder="Project meeting and slides"
      /></label
    ><button disabled={busy}>{busy ? 'Uploading…' : 'Upload to staging'}</button
    >
  </form>
  {#if message}<p class="error">{message}</p>{/if}
  <p class="hint">
    Files stay in staging until you explicitly push them to memory.
  </p>
</section>
<section class="files">
  <h2>Staging files <span class="badge">{uploads.length}</span></h2>
  {#if !uploads.length}<div class="card empty">
      No source files yet. Add a recording, document or image.
    </div>{:else}<div class="list">
      {#each groups as group}
        {#if group.files[0].metadata.groupId}<div class="group-label">
            {group.files[0].metadata.groupHint} · {group.files.length} files
            <small
              >Grouping is context, not proof these sources were discussed
              together.</small
            >
          </div>{/if}
        {#each group.files as file}<div class="selectable-row">
            <input
              type="checkbox"
              aria-label={`Select ${file.filename}`}
              checked={selected.some((s) => s.uploadId === file.id)}
              disabled={!file.currentRevisionId}
              onchange={(e) => changeSelection(file, !e.currentTarget.checked)}
            />
            <a class="row" href={`/staging/${file.id}`}
              ><span class="icon"
                >{file.filename.match(/\.(mp4|mov|mkv|webm)$/i)
                  ? '▶'
                  : '▤'}</span
              ><span class="details"
                ><strong>{file.metadata.label || file.filename}</strong><small
                  >{file.filename} · {file.metadata.uploader} · {(
                    file.bytes / 1024
                  ).toFixed(1)} KB</small
                ></span
              ><span class="status"
                ><span class="badge"
                  >{file.run?.state.replaceAll('_', ' ') || 'queued'}</span
                ><small>{file.run?.progress}</small><small
                  >{file.memory.state.replaceAll('_', ' ')}{file.memory
                    .commitVersion !== null
                    ? ` · Memory ${file.memory.commitVersion}`
                    : ''}</small
                ></span
              ><span>→</span></a
            >
          </div>{/each}{/each}
    </div>{/if}
</section>

{#if selected.length}<section class="card batch-review">
    <h2>Selected revisions ({selected.length})</h2>
    <p class="muted">
      Selection pins whole staging revisions. Later edits keep the selected
      evidence unchanged.
    </p>
    {#each selected as item}{@const file = uploads.find(
        (f) => f.id === item.uploadId,
      )}
      <article class="selection-item">
        <a href={`/staging/${item.uploadId}?revision=${item.revisionId}`}
          >{item.metadata.label || item.filename}</a
        >
        <span class="badge">Revision {item.revisionId.slice(0, 8)}</span>
        {#if item.stale}<p class="warning">
            A newer revision exists. The older revision stays selected.
          </p>
          {#if file}<button
              class="secondary"
              onclick={() => changeSelection(file!, false, false)}
              >Select current revision</button
            >{/if}{/if}
        {#if item.warnings.length}<details>
            <summary
              >{item.warnings.length} coverage warnings{item.complete
                ? ''
                : ' · Partial extraction'}</summary
            >
            <ul>
              {#each item.warnings as warning}<li>{warning}</li>{/each}
            </ul>
          </details>{/if}
        {#if !item.complete && file}<label class="partial"
            ><input
              type="checkbox"
              checked={item.acceptPartial}
              onchange={(e) =>
                changeSelection(
                  file!,
                  false,
                  e.currentTarget.checked,
                  item.revisionId,
                )}
            />Include this partial extraction when pushing</label
          >{/if}
        {#if file}<button
            class="secondary"
            onclick={() => changeSelection(file!, true)}
            >Remove selection</button
          >{/if}
      </article>
    {/each}
    <label
      >Project matching<select bind:value={projectMode}
        ><option value="auto">Automatic, based on content</option><option
          value="existing">Use an existing project</option
        ><option value="new">Create a separate project</option></select
      ></label
    >
    {#if projectMode === 'existing'}<label
        >Existing project<select bind:value={projectId}
          ><option value="">Choose a project</option
          >{#each data.projects as project}<option value={project.id}
              >{project.name}</option
            >{/each}</select
        ></label
      >{/if}
    {#if projectMode === 'new'}<label
        >New project name<input bind:value={projectName} /></label
      >{/if}
    <button
      disabled={pushing ||
        selected.some((s) => !s.readyForPush) ||
        (projectMode === 'existing' && !projectId) ||
        (projectMode === 'new' && !projectName.trim())}
      onclick={pushSelection}
      >{pushing ? 'Creating push…' : 'Push selected files to memory'}</button
    >
    <p class="hint">
      {selected.some((s) => !s.readyForPush)
        ? 'Review partial extraction before including these files. '
        : ''}Selection is saved. Automatic matching can create multiple projects
      from one meeting; grouping alone does not merge projects.
    </p>
  </section>{/if}

<style>
  select {
    font: inherit;
    padding: 10px;
    border: 1px solid #ccd6e2;
    border-radius: 6px;
    background: white;
  }
  .batch-review > label {
    margin: 14px 0;
  }
  .group-label {
    padding: 14px 20px;
    background: #edf2f9;
  }
  .group-label small {
    display: block;
    color: #66768b;
  }
  .selectable-row {
    display: flex;
    align-items: center;
    padding-left: 18px;
    border-bottom: 1px solid #edf0f4;
  }
  .selectable-row .row {
    flex: 1;
    border: 0;
  }
  .selectable-row input,
  .partial input {
    width: auto;
  }
  .batch-review {
    margin-top: 24px;
  }
  .selection-item {
    padding: 18px 0;
    border-bottom: 1px solid #edf0f4;
    margin-bottom: 16px;
  }
  .selection-item .badge {
    margin-left: 12px;
  }
  .partial {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 14px 0;
  }

  .intro {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 24px;
  }
  .memory {
    display: grid;
    text-align: right;
    align-content: center;
  }
  .memory strong {
    font-size: 28px;
  }
  .memory span {
    font-size: 12px;
    color: #66768b;
  }
  form {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    align-items: end;
  }
  .file {
    flex: 2;
    min-width: 230px;
  }
  form label {
    flex: 1;
    min-width: 150px;
  }
  .hint {
    font-size: 12px;
    color: #66768b;
    margin-bottom: 0;
  }
  .files {
    margin-top: 34px;
  }
  .list {
    background: white;
    border: 1px solid #dfe5ec;
    border-radius: 12px;
    overflow: hidden;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 22px;
    color: #172536;
    border-bottom: 1px solid #edf0f4;
  }
  .row:last-child {
    border: 0;
  }
  .row:hover {
    background: #f9fbfd;
    text-decoration: none;
  }
  .icon {
    background: #edf2f9;
    color: #235dba;
    border-radius: 8px;
    padding: 11px 16px;
  }
  .details {
    display: grid;
    flex: 1;
  }
  .details small,
  .status small {
    color: #66768b;
    font-size: 12px;
  }
  .status {
    display: grid;
    text-align: right;
    gap: 5px;
  }
  .empty {
    color: #66768b;
    text-align: center;
    padding: 44px;
  }
  @media (max-width: 700px) {
    .intro {
      display: block;
    }
    .memory {
      display: none;
    }
    .row {
      gap: 12px;
      padding: 16px;
    }
    .status small {
      display: none;
    }
  }
</style>
