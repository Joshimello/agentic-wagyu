<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '../lib/components/Icon.svelte';
  import Disclosure from '../lib/components/Disclosure.svelte';
  import Select from '../lib/components/Select.svelte';
  import Tooltip from '../lib/components/Tooltip.svelte';
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
  let uploader = $state('local'),
    groupHint = $state('');
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
      uploader = 'local';
      groupHint = '';
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
    <p class="muted">Add a recording, slides, or a document.</p>
  </div>
  <a class="button-link" href="/memory"
    ><Icon name="grid" size={17} />View memory
    <span class="commit-count">{data.memoryCount}</span></a
  >
</div>

<section class="card upload-card">
  <div class="section-heading">
    <h2>Add source files</h2>
    <span class="private-note"
      ><Icon name="folder" size={15} />Staging first</span
    >
  </div>
  <form onsubmit={upload}>
    <div class="upload-controls">
      <label class="file"
        >Source files<input required name="file" type="file" multiple /></label
      >
      <button class="upload-button" disabled={busy}
        ><Icon name={busy ? 'clock' : 'upload'} size={18} />{busy
          ? 'Uploading...'
          : 'Upload to staging'}</button
      >
    </div>
    <input type="hidden" name="uploader" value={uploader} />
    <input type="hidden" name="groupHint" value={groupHint} />
    <Disclosure title="Upload details" icon="info">
      <div class="upload-details">
        <label>Uploaded by<input bind:value={uploader} /></label>
        <label
          >Group / project hint (optional)<input
            bind:value={groupHint}
            placeholder="Project meeting and slides"
          /></label
        >
      </div>
    </Disclosure>
  </form>
  <p class="hint">Review here before adding anything to memory.</p>
</section>

{#if message}<p class="error" role="alert">{message}</p>{/if}

<section class="files">
  <div class="section-heading">
    <h2>Staging files <span class="badge">{uploads.length}</span></h2>
    <span class="muted small">Select files to push</span>
  </div>
  {#if !uploads.length}
    <div class="card empty">
      <span class="empty-icon"><Icon name="folder" size={34} /></span>
      <h3>Your sources will appear here</h3>
      <p>Upload your first file to start reviewing.</p>
    </div>
  {:else}
    <div class="list">
      {#each groups as group}
        {#if group.files[0].metadata.groupId}
          <div class="group-label">
            <Icon name="folder" size={16} /><strong
              >{group.files[0].metadata.groupHint}</strong
            ><span>{group.files.length} files</span>
            <Tooltip
              text="A group keeps related uploads together. It does not establish that every source was discussed."
              ><button
                type="button"
                class="group-info"
                aria-label="About source grouping"
                ><Icon name="info" size={15} /></button
              ></Tooltip
            >
          </div>
        {/if}
        {#each group.files as file}
          <div
            class="selectable-row"
            class:selected-row={selected.some((s) => s.uploadId === file.id)}
          >
            <input
              type="checkbox"
              aria-label={`Select ${file.filename}`}
              checked={selected.some((s) => s.uploadId === file.id)}
              disabled={!file.currentRevisionId}
              onchange={(e) => changeSelection(file, !e.currentTarget.checked)}
            />
            <a class="row" href={`/staging/${file.id}`}>
              <span class="file-icon"
                ><Icon
                  name={file.filename.match(/\.(mp4|mov|mkv|webm)$/i)
                    ? 'video'
                    : file.filename.match(/\.(mp3|wav|m4a|flac)$/i)
                      ? 'audio'
                      : 'file'}
                  size={22}
                /></span
              >
              <span class="details"
                ><strong>{file.metadata.label || file.filename}</strong><small
                  >{file.metadata.label && file.metadata.label !== file.filename
                    ? `${file.filename} / `
                    : ''}{file.metadata.uploader} / {file.bytes >= 1048576
                    ? `${(file.bytes / 1048576).toFixed(1)} MB`
                    : `${(file.bytes / 1024).toFixed(1)} KB`}</small
                ></span
              >
              <span class="status"
                ><span class="badge state-badge" data-state={file.run?.state}
                  >{file.run?.state.replaceAll('_', ' ') || 'queued'}</span
                >
                {#if file.run?.progress}<span
                    class="progress"
                    title={file.run.progress}>{file.run.progress}</span
                  >{/if}
                <small
                  >{file.memory.state.replaceAll('_', ' ')}{file.memory
                    .commitVersion !== null
                    ? ` / Memory ${file.memory.commitVersion}`
                    : ''}</small
                >
              </span>
              <span class="row-arrow"
                ><Icon name="arrow-right" size={18} /></span
              >
            </a>
          </div>
        {/each}
      {/each}
    </div>
  {/if}
</section>

{#if selected.length}
  <section class="card batch-review">
    <div class="section-heading">
      <h2>Selected files <span class="badge">{selected.length}</span></h2>
      <Tooltip
        text="Selection saves exact revisions. Later edits keep this selection pinned until you choose the newer revision."
        ><button
          class="info-button secondary icon-button"
          type="button"
          aria-label="About selected revisions"
          ><Icon name="info" size={18} /></button
        ></Tooltip
      >
    </div>
    {#each selected as item}
      {@const file = uploads.find((f) => f.id === item.uploadId)}
      <article class="selection-item">
        <div class="selection-heading">
          <a href={`/staging/${item.uploadId}?revision=${item.revisionId}`}
            >{item.metadata.label || item.filename}</a
          ><span class="revision-label"
            >Revision {item.revisionId.slice(0, 8)}</span
          >
          {#if file}<Tooltip
              text="Remove this file from the push selection. The source stays in staging."
              ><button
                type="button"
                class="secondary icon-button"
                aria-label={`Remove ${item.filename} from selection`}
                onclick={() => changeSelection(file!, true)}
                ><Icon name="close" size={16} /></button
              ></Tooltip
            >{/if}
        </div>
        {#if item.stale}
          <div class="revision-warning">
            <p class="warning">
              A newer revision exists. This selection still uses the earlier
              revision.
            </p>
            {#if file}<button
                type="button"
                class="secondary"
                onclick={() => changeSelection(file!, false, false)}
                ><Icon name="refresh" size={16} />Use current revision</button
              >{/if}
          </div>
        {/if}
        {#if item.warnings.length}
          <Disclosure
            title={`${item.warnings.length} coverage warnings${item.complete ? '' : ' / Partial extraction'}`}
            icon="warning"
            ><ul>
              {#each item.warnings as warning}<li>{warning}</li>{/each}
            </ul></Disclosure
          >
        {/if}
        {#if !item.complete && file}
          <label class="partial"
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
          >
        {/if}
      </article>
    {/each}
    <div class="project-controls">
      <Select
        label="Project matching"
        bind:value={projectMode}
        options={[
          { value: 'auto', label: 'Automatic, based on content' },
          { value: 'existing', label: 'Use an existing project' },
          { value: 'new', label: 'Create a separate project' },
        ]}
      />
      {#if projectMode === 'existing'}<Select
          label="Existing project"
          bind:value={projectId}
          options={[
            { value: '', label: 'Choose a project' },
            ...data.projects.map((project) => ({
              value: project.id,
              label: project.name,
            })),
          ]}
        />{/if}
      {#if projectMode === 'new'}<label
          >New project name<input bind:value={projectName} /></label
        >{/if}
    </div>
    <div class="push-controls">
      <button
        class="push-button"
        disabled={pushing ||
          selected.some((s) => !s.readyForPush) ||
          (projectMode === 'existing' && !projectId) ||
          (projectMode === 'new' && !projectName.trim())}
        onclick={pushSelection}
        ><Icon name={pushing ? 'clock' : 'arrow-up'} size={18} />{pushing
          ? 'Creating push...'
          : 'Push selected files to memory'}</button
      >
      {#if selected.some((s) => !s.readyForPush)}<p class="hint">
          Review partial extraction before pushing.
        </p>{:else}<Tooltip
          text="Automatic matching may create multiple projects from one meeting. Upload grouping alone does not merge projects."
          ><span class="selection-saved"
            ><Icon name="check" size={16} />Selection saved</span
          ></Tooltip
        >{/if}
    </div>
  </section>
{/if}

<style>
  .intro {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 2rem;
    margin-bottom: 2rem;
  }
  .intro p {
    margin-bottom: 0;
  }
  .intro .button-link {
    flex: none;
  }
  .commit-count {
    display: grid;
    place-items: center;
    min-width: 1.3rem;
    height: 1.3rem;
    border-radius: 4px;
    background: var(--canvas);
    font-size: 0.72rem;
  }
  .section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .section-heading h2 {
    margin: 0;
  }
  .section-heading .badge {
    margin-left: 0.35rem;
    vertical-align: middle;
  }
  .private-note {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .upload-controls {
    display: flex;
    align-items: end;
    gap: 1rem;
    margin-bottom: 0.35rem;
  }
  .file {
    flex: 1;
    min-width: 0;
  }
  .file input {
    width: 100%;
    min-height: 3rem;
  }
  .upload-button,
  .push-button {
    display: inline-flex;
    gap: 0.55rem;
    align-items: center;
    justify-content: center;
    min-height: 3rem;
    white-space: nowrap;
  }
  .upload-details {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 1rem;
  }
  .hint {
    font-size: 0.78rem;
    color: var(--muted);
    margin-bottom: 0;
  }
  .files {
    margin-top: 2.5rem;
  }
  .list {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .group-label {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    padding: 0.75rem 1.3rem;
    background: var(--surface-soft);
    border-bottom: 1px solid var(--border);
    font-size: 0.83rem;
  }
  .group-label strong {
    font-weight: 500;
  }
  .group-label span {
    font-size: 0.74rem;
    color: var(--muted);
  }
  .group-info {
    display: flex;
    background: transparent;
    color: var(--muted);
    padding: 0.2rem;
    border: 0;
  }
  .selectable-row {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0 1.3rem;
    border-bottom: 1px solid var(--border);
    transition: background 180ms;
  }
  .selectable-row:last-child {
    border-bottom: 0;
  }
  .selectable-row:hover {
    background: var(--surface-soft);
  }
  .selectable-row.selected-row {
    background: #f4f7f1;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.1rem 0;
    min-width: 0;
    flex: 1;
    color: var(--ink);
  }
  .row:hover {
    text-decoration: none;
  }
  .file-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 2.8rem;
    height: 2.8rem;
    background: var(--canvas);
    color: #5a5a50;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .details {
    display: grid;
    gap: 0.15rem;
    flex: 1;
    min-width: 0;
  }
  .details strong {
    font-size: 0.93rem;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .details small,
  .status small {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .status {
    display: grid;
    justify-items: end;
    text-align: right;
    gap: 0.2rem;
    flex: none;
    max-width: 17rem;
  }
  .progress {
    max-width: 17rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .state-badge {
    text-transform: capitalize;
    font-size: 0.69rem;
  }
  .state-badge[data-state='processing'],
  .state-badge[data-state='queued'] {
    color: var(--blue-ink);
    background: var(--blue-soft);
  }
  .state-badge[data-state='ready_with_warnings'] {
    color: var(--yellow-ink);
    background: var(--yellow-soft);
  }
  .state-badge[data-state='failed'] {
    color: var(--red-ink);
    background: var(--red-soft);
  }
  .row-arrow {
    flex: none;
    color: #95958c;
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
  }
  .empty-icon {
    display: inline-flex;
    color: #909085;
  }
  .empty h3 {
    margin: 1rem 0 0.25rem;
  }
  .empty p {
    font-size: 0.87rem;
    margin: 0;
  }
  .batch-review {
    margin-top: 2rem;
  }
  .selection-item {
    padding: 0.9rem 0;
    border-bottom: 1px solid var(--border);
  }
  .selection-heading {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .selection-heading a {
    font-weight: 500;
    flex: 1;
    overflow-wrap: anywhere;
  }
  .revision-label {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .selection-heading :global(.icon-button) {
    width: 2rem;
    height: 2rem;
  }
  .revision-warning {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.7rem;
    margin-top: 0.6rem;
  }
  .revision-warning p {
    margin: 0;
  }
  .revision-warning button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
  }
  .partial {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.8rem 0 0;
    color: var(--yellow-ink);
  }
  .project-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin: 1.4rem 0;
  }
  .push-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .selection-saved {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--green-ink);
    font-size: 0.77rem;
  }
  @media (max-width: 750px) {
    .intro {
      align-items: start;
      gap: 1rem;
    }
    .intro .button-link {
      font-size: 0.76rem;
      padding: 0.5rem 0.6rem;
    }
    .status {
      max-width: 9rem;
    }
    .progress {
      max-width: 9rem;
    }
    .status small {
      display: none;
    }
    .selectable-row {
      padding: 0 0.9rem;
      gap: 0.6rem;
    }
    .row {
      gap: 0.65rem;
    }
    .file-icon {
      width: 2.4rem;
      height: 2.4rem;
    }
    .upload-details {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 500px) {
    .intro {
      flex-direction: column;
    }
    .upload-controls {
      flex-direction: column;
      align-items: stretch;
    }
    .private-note {
      display: none;
    }
    .project-controls {
      grid-template-columns: 1fr;
    }
    .row-arrow {
      display: none;
    }
    .details small {
      font-size: 0.66rem;
    }
    .status {
      max-width: 7rem;
    }
    .progress {
      display: none;
    }
    .state-badge {
      font-size: 0.62rem;
    }
    .revision-label {
      display: none;
    }
  }
</style>
