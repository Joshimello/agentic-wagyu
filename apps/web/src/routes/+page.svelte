<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { useActivity } from '../lib/ui/activity.svelte';
  import Icon from '../lib/components/Icon.svelte';
  import Disclosure from '../lib/components/Disclosure.svelte';
  import Select from '../lib/components/Select.svelte';
  import Tooltip from '../lib/components/Tooltip.svelte';
  import ProgressBar from '../lib/components/ProgressBar.svelte';
  import SourceDetails from '../lib/components/SourceDetails.svelte';
  import SourceProjectField from '../lib/components/SourceProjectField.svelte';
  import { groupStagingSources, sourceProjectName, sourceProjectNames } from '../lib/source-organization';
  let { data } = $props();
  const activity = useActivity();
  let uploads = $state(untrack(() => data.uploads));
  let selected = $state(untrack(() => data.selections));
  let localChosen = $state<string[]>([]);
  let choosing = $state(false);
  let removing = $state(false);
  let removalDialog = $state<HTMLDialogElement>();
  let pendingRemovalIds = $state<string[]>([]);
  let chosenIds = $derived(
    [
      ...new Set([...selected.map((item) => item.uploadId), ...localChosen]),
    ].filter((id) => uploads.some((file) => file.id === id)),
  );
  let refreshVersion = 0;
  let detailsEditor = $state<ReturnType<typeof SourceDetails>>();
  let stagingProjects = $derived(sourceProjectNames([
    ...data.projects.map((project) => project.name),
    ...uploads.map((file) => sourceProjectName(file.metadata)),
  ]));
  let pushing = $state(false),
    projectMode = $state('auto'),
    projectId = $state(''),
    projectName = $state('');
  let acceptedPushId = $state<string | null>(null);
  function addedToMemory(
    file: (typeof uploads)[number],
    revisionId = file.currentRevisionId,
  ) {
    return Boolean(
      revisionId &&
      (file.memory.revisionId === revisionId ||
        file.memory.admittedRevisionIds?.includes(revisionId) ||
        (file.memory.state === 'incorporated' &&
          revisionId === file.currentRevisionId)),
    );
  }
  let pendingSelections = $derived(
    selected.filter((item) => {
      const file = uploads.find((source) => source.id === item.uploadId);
      return file && !addedToMemory(file, item.revisionId);
    }),
  );
  let unreadyChosen = $derived(
    chosenIds.some((id) => {
      const file = uploads.find((source) => source.id === id);
      return (
        file &&
        !addedToMemory(file) &&
        !pendingSelections.some((item) => item.uploadId === id)
      );
    }),
  );
  let memoryPushActive = $derived(
    pendingSelections.some(
      (item) =>
        uploads.find((file) => file.id === item.uploadId)?.memory.state ===
        'push_pending',
    ) ||
      activity.tasks.some(
        (task) =>
          task.kind === 'push' &&
          task.id === acceptedPushId &&
          ['queued', 'processing'].includes(task.state),
      ),
  );
  async function pushSelection() {
    if (
      pushing ||
      memoryPushActive ||
      removing ||
      choosing ||
      !pendingSelections.length ||
      pendingSelections.some((item) => !item.readyForPush) ||
      unreadyChosen
    )
      return;
    pushing = true;
    message = '';
    try {
      const response = await fetch('/api/pushes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          items: pendingSelections.map((s) => ({
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
      acceptedPushId = result.id;
      await activity.refresh();
      activity.reveal();
    } catch (error) {
      message = error instanceof Error ? error.message : 'Push failed';
    } finally {
      pushing = false;
    }
  }
  let groups = $derived(groupStagingSources(uploads));
  async function detailsUpdated() {
    refreshVersion += 1;
    const [files, selections] = await Promise.all([fetch('/api/uploads'), fetch('/api/selections')]);
    if (!files.ok || !selections.ok) throw new Error('Details saved. Reload Staging to see your changes.');
    uploads = await files.json();
    selected = await selections.json();
  }
  async function changeSelection(
    file: (typeof uploads)[number],
    remove = false,
    acceptPartial = false,
    revisionId = file.currentRevisionId,
  ) {
    message = '';
    if (choosing || removing || pushing) return;
    const wasPinned = selected.some((item) => item.uploadId === file.id);
    if (remove) localChosen = localChosen.filter((id) => id !== file.id);
    if (
      (!file.currentRevisionId || addedToMemory(file, revisionId) || remove) &&
      !wasPinned
    ) {
      if (!remove && !localChosen.includes(file.id))
        localChosen = [...localChosen, file.id];
      return;
    }
    choosing = true;
    refreshVersion += 1;
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
      localChosen = localChosen.filter((id) => id !== file.id);
    } catch (e) {
      message = e instanceof Error ? e.message : 'Selection failed';
    } finally {
      choosing = false;
    }
  }
  let busy = $state(false),
    message = $state('');
  let uploader = $state('local'),
    groupHint = $state('');
  let uploadMeetingTime = $state('');
  let uploadDetailsVersion = $state(0);
  let sourceFiles = $state<File[]>([]);
  let sourceInput = $state<HTMLInputElement>();
  let uploadDetailsOpen = $state(false);
  let dragging = $state(false);

  function chooseFiles(files: FileList | null) {
    sourceFiles = Array.from(files ?? []);
    if (sourceFiles.length) uploadDetailsOpen = true;
    message = '';
  }

  function clearSourceFiles() {
    if (sourceInput) sourceInput.value = '';
    sourceFiles = [];
    uploadDetailsOpen = false;
    dragging = false;
    message = '';
  }

  function dropzone(node: HTMLElement) {
    let depth = 0;
    const containsFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const enter = (event: DragEvent) => {
      if (!containsFiles(event) || busy) return;
      event.preventDefault();
      depth += 1;
      dragging = true;
    };
    const over = (event: DragEvent) => {
      if (!containsFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) dragging = false;
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      dragging = false;
      if (busy || !event.dataTransfer?.files.length || !sourceInput) return;
      sourceInput.files = event.dataTransfer.files;
      chooseFiles(sourceInput.files);
    };
    node.addEventListener('dragenter', enter);
    node.addEventListener('dragover', over);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);
    return {
      destroy() {
        node.removeEventListener('dragenter', enter);
        node.removeEventListener('dragover', over);
        node.removeEventListener('dragleave', leave);
        node.removeEventListener('drop', drop);
      },
    };
  }

  function confirmRemoval() {
    pendingRemovalIds = [...chosenIds];
    removalDialog?.showModal();
  }

  async function removeChosenFiles() {
    if (removing || !pendingRemovalIds.length) return;
    removing = true;
    message = '';
    refreshVersion += 1;
    try {
      const response = await fetch('/api/uploads/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadIds: pendingRemovalIds }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Removal failed');
      const removedIds: string[] = result.removedIds;
      uploads = uploads.filter((file) => !removedIds.includes(file.id));
      localChosen = localChosen.filter((id) => !removedIds.includes(id));
      selected = selected.filter((item) => !removedIds.includes(item.uploadId));
      removalDialog?.close();
    } catch (error) {
      removalDialog?.close();
      message = error instanceof Error ? error.message : 'Removal failed';
    } finally {
      removing = false;
      pendingRemovalIds = [];
    }
  }
  $effect(() => {
    uploads = data.uploads;
    selected = data.selections;
  });
  onMount(() => {
    const timer = setInterval(async () => {
      if (removing || choosing || busy || pushing) return;
      const version = refreshVersion;
      try {
        const r = await fetch('/api/uploads');
        const refreshedUploads = r.ok ? await r.json() : null;
        if (refreshedUploads && version === refreshVersion && !removing)
          uploads = refreshedUploads;
        const selections = await fetch('/api/selections');
        const refreshedSelections = selections.ok
          ? await selections.json()
          : null;
        if (
          refreshedSelections &&
          version === refreshVersion &&
          !choosing &&
          !removing
        )
          selected = refreshedSelections;
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  });
  async function upload(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !sourceFiles.length) return;
    const form = event.currentTarget as HTMLFormElement;
    const body = new FormData(form);
    body.set('sourceTime', uploadMeetingTime ? new Date(uploadMeetingTime).toISOString() : '');
    const filenames = sourceFiles.map((file) => file.name.slice(0, 255));
    const sessionId = crypto.randomUUID();
    let xhr: XMLHttpRequest | undefined;
    let canceled = false;
    activity.beginUpload(sessionId, filenames, () => {
      canceled = true;
      xhr?.abort();
    });
    refreshVersion += 1;
    busy = true;
    message = '';
    try {
      const started = await fetch('/api/upload-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, filenames }),
      });
      const session = await started.json();
      if (!started.ok)
        throw new Error(session.error || 'Could not begin upload');
      if (canceled || session.state === 'canceled')
        throw new DOMException('Upload canceled', 'AbortError');
      await new Promise<void>((resolve, reject) => {
        xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/uploads?session=${sessionId}`);
        xhr.responseType = 'json';
        xhr.upload.onprogress = (event) =>
          activity.uploadProgress(
            sessionId,
            event.lengthComputable
              ? Math.round((event.loaded / event.total) * 100)
              : null,
          );
        xhr.onload = () =>
          xhr!.status >= 200 && xhr!.status < 300
            ? resolve()
            : reject(new Error(xhr!.response?.error || 'Upload failed'));
        xhr.onerror = () =>
          reject(
            new Error(
              'Upload connection interrupted. Check Staging before retrying.',
            ),
          );
        xhr.onabort = () =>
          reject(new DOMException('Upload canceled', 'AbortError'));
        xhr.send(body);
      });
      activity.finishUpload(sessionId, 'accepted');
      if (form.isConnected) {
        form.reset();
        clearSourceFiles();
        uploader = 'local';
        groupHint = '';
        uploadMeetingTime = '';
        uploadDetailsVersion += 1;
        uploads = await (await fetch('/api/uploads')).json();
      }
    } catch (e) {
      if (!canceled) {
        try {
          const outcome = await fetch(
            `/api/upload-sessions/${sessionId}/fail`,
            { method: 'POST' },
          );
          const session = await outcome.json();
          if (outcome.ok && session.state === 'accepted') {
            activity.finishUpload(sessionId, 'accepted');
            if (form.isConnected) {
              form.reset();
              clearSourceFiles();
              uploads = await (await fetch('/api/uploads')).json();
            }
            return;
          }
        } catch {}
      }
      activity.finishUpload(sessionId, canceled ? 'canceled' : 'failed');
      if (form.isConnected)
        message = canceled
          ? 'Upload canceled. Your chosen files are ready to retry.'
          : e instanceof Error
            ? e.message
            : 'Upload failed';
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

<section
  class="card upload-card"
  class:dragging
  use:dropzone
  aria-label="Add source files"
>
  <div class="section-heading">
    <h2>Add source files</h2>
    <span class="private-note"
      ><Icon name="folder" size={15} />Staging first</span
    >
  </div>
  <form onsubmit={upload}>
    <div class="upload-controls">
      <div class="file">
        <label for="source-files">Source files</label>
        <div class="file-input-wrap">
          <input
            id="source-files"
            bind:this={sourceInput}
            required
            name="file"
            type="file"
            multiple
            disabled={busy}
            onchange={(event) => chooseFiles(event.currentTarget.files)}
          />
          {#if sourceFiles.length}
            <Tooltip text="Clear the chosen source files">
              <button
                type="button"
                class="secondary icon-button clear-files"
                aria-label="Clear source files"
                disabled={busy}
                onclick={clearSourceFiles}
                ><Icon name="close" size={17} /></button
              >
            </Tooltip>
          {/if}
        </div>
      </div>
      <button class="upload-button" disabled={busy || !sourceFiles.length}
        ><Icon name={busy ? 'clock' : 'upload'} size={18} />{busy
          ? 'Uploading...'
          : 'Upload to staging'}</button
      >
    </div>
    <input type="hidden" name="uploader" value={uploader} />
    <input type="hidden" name="groupHint" value={groupHint} />
    <p class="drop-hint" aria-live="polite">
      <Icon name={dragging ? 'upload' : 'file'} size={15} />{dragging
        ? 'Drop to choose your source files'
        : sourceFiles.length
          ? `${sourceFiles.length} ${sourceFiles.length === 1 ? 'file' : 'files'} chosen`
          : 'Or drag files here'}
    </p>
    <Disclosure title="Upload details" chevron bind:open={uploadDetailsOpen}>
      <div class="upload-details">
        <label>Uploaded by<input bind:value={uploader} /></label>
        <label>Meeting date and time (optional)<input type="datetime-local" bind:value={uploadMeetingTime} disabled={busy} /></label>
        {#key uploadDetailsVersion}<SourceProjectField projects={stagingProjects} bind:value={groupHint} disabled={busy} />{/key}
      </div>
    </Disclosure>
  </form>
  <p class="hint">Review here before adding anything to memory.</p>
</section>

{#if message}<p class="error" role="alert">{message}</p>{/if}

<section class="files">
  <div class="section-heading">
    <h2>Staging files <span class="badge">{uploads.length}</span></h2>
    <div class="staging-actions">
      {#if chosenIds.length}
        <span class="muted small">{chosenIds.length} selected</span>
        <Tooltip
          text="Remove files from Staging. Saved memory and evidence are kept."
        >
          <button
            type="button"
            class="secondary remove-button"
            disabled={removing || pushing || choosing}
            onclick={confirmRemoval}
            ><Icon name="trash" size={17} />Remove selected</button
          >
        </Tooltip>
      {:else}<span class="muted small">Select to push or remove</span>{/if}
    </div>
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
          <div class="group-label">
            <Icon name="folder" size={16} /><strong
              >{group.name}</strong
            ><span>{group.files.length} files</span>
            <Tooltip
              text="Project names organize your staging files. Sources without a name appear under No project."
              ><button
                type="button"
                class="group-info"
                aria-label="About source grouping"
                ><Icon name="info" size={15} /></button
              ></Tooltip
            >
          </div>
        {#each group.files as file}
          <div
            class="selectable-row"
            class:selected-row={chosenIds.includes(file.id)}
          >
            <input
              type="checkbox"
              aria-label={`Select ${file.filename}`}
              checked={chosenIds.includes(file.id)}
              disabled={choosing || removing || pushing}
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
                    : ''}{file.metadata.sourceTime ? `${new Date(file.metadata.sourceTime).toLocaleDateString()} / ` : ''}{file.metadata.uploader} / {file.bytes >= 1048576
                    ? `${(file.bytes / 1048576).toFixed(1)} MB`
                    : `${(file.bytes / 1024).toFixed(1)} KB`}</small
                ></span
              >
              <span class="status"
                ><span
                  class="badge state-badge"
                  data-state={addedToMemory(file)
                    ? 'incorporated'
                    : file.run?.state}
                  >{addedToMemory(file)
                    ? 'Added to memory'
                    : file.run?.state.replaceAll('_', ' ') || 'queued'}</span
                >
                {#if file.run && ['processing', 'queued'].includes(file.run.state)}
                  <ProgressBar
                    value={file.run.progressPercent ?? null}
                    label={file.run.progress || 'Waiting to process'}
                    state={file.run.state}
                    compact
                  />
                {/if}
                <small
                  >{addedToMemory(file)
                    ? 'Saved'
                    : file.memory.state.replaceAll('_', ' ')}{file.memory
                    .commitVersion !== null
                    ? ` / Memory ${file.memory.commitVersion}`
                    : ''}</small
                >
              </span>
              <span class="row-arrow"
                ><Icon name="arrow-right" size={18} /></span
              >
            </a>
            <button class="secondary icon-button edit-source" aria-label={`Edit details for ${file.metadata.label || file.filename}`}
              disabled={removing || ['queued', 'processing'].includes(file.run?.state ?? '') || file.run?.retryPending}
              title={['queued', 'processing'].includes(file.run?.state ?? '') || file.run?.retryPending ? 'Available after processing finishes' : 'Edit details'}
              onclick={() => detailsEditor?.open(file)}><Icon name="edit" size={17} /></button>
          </div>
        {/each}
      {/each}
    </div>
  {/if}
</section>

<SourceDetails bind:this={detailsEditor} projects={stagingProjects} onupdated={detailsUpdated} />

{#if pendingSelections.length}
  <section class="card batch-review">
    <div class="section-heading">
      <h2>
        Selected files <span class="badge">{pendingSelections.length}</span>
      </h2>
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
    {#each pendingSelections as item}
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
          memoryPushActive ||
          removing ||
          choosing ||
          unreadyChosen ||
          pendingSelections.some((s) => !s.readyForPush) ||
          (projectMode === 'existing' && !projectId) ||
          (projectMode === 'new' && !projectName.trim())}
        onclick={pushSelection}
        ><Icon
          name={pushing || memoryPushActive ? 'clock' : 'arrow-up'}
          size={18}
        />{pushing || memoryPushActive
          ? 'Creating push...'
          : 'Push To Memory'}</button
      >
      {#if unreadyChosen}<p class="hint">
          Some selected files are not ready to push yet.
        </p>
      {:else if pendingSelections.some((s) => !s.readyForPush)}<p class="hint">
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

<dialog
  class="removal-dialog"
  bind:this={removalDialog}
  aria-labelledby="removal-title"
  aria-describedby="removal-description"
  oncancel={(event) => {
    if (removing) event.preventDefault();
  }}
>
  <h2 id="removal-title">Remove selected files from Staging?</h2>
  <p id="removal-description">
    Saved memory and evidence are kept. Processing will stop for the {pendingRemovalIds.length}
    selected {pendingRemovalIds.length === 1 ? 'file' : 'files'}.
  </p>
  <div class="dialog-actions">
    <button
      class="secondary"
      type="button"
      disabled={removing}
      onclick={() => removalDialog?.close()}>Keep files</button
    >
    <button
      class="remove-confirm"
      type="button"
      disabled={removing}
      onclick={removeChosenFiles}
      ><Icon name={removing ? 'clock' : 'trash'} size={18} />{removing
        ? 'Removing...'
        : 'Remove files'}</button
    >
  </div>
</dialog>

<style>
  .intro {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 2rem;
    margin-bottom: 2rem;
  }
  .intro h1 {
    font-size: clamp(1.8rem, 2.97vw, 2.7rem);
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
  .upload-card {
    transition:
      border-color 180ms,
      background 180ms;
  }
  .upload-card.dragging {
    border-color: var(--accent);
    background: var(--blue-soft);
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .file-input-wrap {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 6px;
    min-width: 0;
    margin-top: 0.4rem;
    padding-right: 0.35rem;
  }
  .file input {
    width: 100%;
    flex: 1;
    min-width: 0;
    min-height: 3rem;
    border: 0;
    background: transparent;
  }
  .file-input-wrap :global(.clear-files) {
    width: 2rem;
    height: 2rem;
    border: 0;
    background: var(--canvas);
  }
  .drop-hint {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    font-size: 0.77rem;
    margin: 0.7rem 0 0.15rem;
  }
  .dragging .drop-hint {
    color: var(--blue-ink);
  }
  .upload-button,
  .push-button {
    display: inline-flex;
    gap: 0.55rem;
    align-items: center;
    justify-content: flex-start;
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
  .edit-source {
    flex: none;
    width: 2.1rem;
    height: 2.1rem;
  }
  .selectable-row:hover {
    background: var(--surface-soft);
  }
  .selectable-row.selected-row {
    background: var(--blue-soft);
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
  .status :global(.progress-bar) {
    width: clamp(8rem, 18vw, 17rem);
    max-width: 100%;
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
  .state-badge[data-state='canceled'] {
    color: var(--muted);
    background: var(--canvas);
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
    color: var(--blue-ink);
    font-size: 0.77rem;
  }
  .staging-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .staging-actions :global(.remove-button) {
    padding: 0.55rem 0.7rem;
    font-size: 0.8rem;
    color: var(--red-ink);
  }
  .removal-dialog {
    max-width: min(28rem, calc(100vw - 2rem));
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.5rem;
  }
  .removal-dialog::backdrop {
    background: rgb(18 22 28 / 0.5);
  }
  .removal-dialog p {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.5rem;
  }
  .remove-confirm {
    background: var(--red-ink);
  }
  .remove-confirm:hover {
    background: #832522;
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
      max-width: 100%;
      grid-column: 2;
      justify-items: start;
      text-align: left;
      width: 100%;
    }
    .row {
      display: grid;
      grid-template-columns: 2.4rem minmax(0, 1fr);
    }
    .status :global(.progress-bar) {
      width: 100%;
    }
    .section-heading {
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .staging-actions {
      justify-content: flex-start;
    }
    .group-label {
      flex-wrap: wrap;
    }
    .state-badge {
      font-size: 0.62rem;
    }
    .revision-label {
      display: none;
    }
  }
</style>
