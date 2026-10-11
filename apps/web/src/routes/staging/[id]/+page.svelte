<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { page } from '$app/state';
  import DocumentViewer from '../../../lib/components/DocumentViewer.svelte';
  import TranscriptWorkspace from '../../../lib/components/TranscriptWorkspace.svelte';
  import VisualContext from '../../../lib/components/VisualContext.svelte';
  import Icon from '../../../lib/components/Icon.svelte';
  import LineSidebar from '../../../lib/components/LineSidebar.svelte';
  import Disclosure from '../../../lib/components/Disclosure.svelte';
  import Select from '../../../lib/components/Select.svelte';
  import Menu from '../../../lib/components/Menu.svelte';
  import Tooltip from '../../../lib/components/Tooltip.svelte';
  import { isUsableCandidateName } from '../../../lib/speaker-names';
  let { data } = $props();
  let detail = $state(untrack(() => data));
  let selection = $state(page.url.searchParams.get('revision') || 'current');
  let error = $state('');
  let notice = $state('');
  let retrying = $state(false);
  let activeSection = $state('original-evidence');
  let player = $state<HTMLVideoElement>();
  let transcript = $state<{ openTranscript: (id?: string) => Promise<void> }>();
  let refreshVersion = 0;
  $effect(() => {
    detail = data;
    selection = page.url.searchParams.get('revision') || 'current';
  });
  let stage = $derived(
    detail.revisions.find(
      (r) =>
        r.id ===
        (selection === 'current' ? detail.upload.currentRevisionId : selection),
    )?.manifest,
  );
  let isVideo = $derived(
    /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(detail.upload.filename),
  );
  let current = $derived(stage?.id === detail.upload.currentRevisionId);
  let busy = $derived(['queued', 'processing'].includes(detail.run.state));
  let speakerSuggestions = $derived(
    stage?.speakerSuggestions?.filter((s) =>
      isUsableCandidateName(s.candidateName),
    ) ?? [],
  );
  let sections = $derived([
    {
      id: 'original-evidence',
      label: 'Original evidence',
      icon: isVideo ? 'video' : 'file',
    },
    {
      id: 'spoken-transcript',
      label: isVideo ? 'Spoken transcript' : 'Extracted text',
      icon: 'transcript',
    },
    ...(stage?.document
      ? [{ id: 'document-review', label: 'Document review', icon: 'image' }]
      : [{ id: 'visual-context', label: 'Visual context', icon: 'image' }]),
  ]);
  let revisions = $derived([
    { value: 'current', label: 'Current revision' },
    ...detail.revisions.map((r) => ({
      value: r.id,
      label: `${new Date(r.createdAt).toLocaleString()} / ${r.id.slice(0, 8)}`,
    })),
  ]);
  onMount(() => {
    let fetching = false;
    const timer = setInterval(async () => {
      if (fetching || !['queued', 'processing'].includes(detail.run.state))
        return;
      fetching = true;
      try {
        await refresh(false);
      } catch {
      } finally {
        fetching = false;
      }
    }, 2000);
    window.addEventListener('hashchange', revealTranscriptAnchor);
    return () => {
      clearInterval(timer);
      window.removeEventListener('hashchange', revealTranscriptAnchor);
    };
  });
  $effect(() => {
    stage?.id;
    if (typeof window !== 'undefined')
      untrack(() => void revealTranscriptAnchor());
  });
  $effect(() => {
    const ids = stage ? sections.map((s) => s.id) : [];
    if (typeof window === 'undefined') return;
    let disposed = false;
    let observer: IntersectionObserver | undefined;
    const intersecting = new Map<string, Element>();
    void tick().then(() => {
      if (disposed) return;
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting)
              intersecting.set(entry.target.id, entry.target);
            else intersecting.delete(entry.target.id);
          });
          const visible = [...intersecting.values()].sort(
            (a, b) =>
              a.getBoundingClientRect().top - b.getBoundingClientRect().top,
          );
          const active = intersecting.get(activeSection);
          if (
            visible[0] &&
            (!active ||
              Math.abs(
                active.getBoundingClientRect().top -
                  visible[0].getBoundingClientRect().top,
              ) > 2)
          )
            activeSection = visible[0].id;
        },
        { rootMargin: '-90px 0px -45% 0px', threshold: 0 },
      );
      ids.forEach((id) => {
        const element = document.getElementById(id);
        if (element) observer?.observe(element);
      });
    });
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  });
  function navigate(id: string) {
    activeSection = id;
    document.getElementById(id)?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  }
  function seek(ms: number) {
    if (player) {
      player.currentTime = ms / 1000;
      navigate('original-evidence');
    }
  }
  async function revealTranscriptAnchor() {
    const id = window.location.hash.replace(/^#text-/, '');
    const revision = stage?.id;
    if (
      !window.location.hash.startsWith('#text-') ||
      stage?.document ||
      !stage?.primitives.some((p) => p.kind === 'text' && p.id === id)
    )
      return;
    await tick();
    if (stage?.id === revision) await transcript?.openTranscript(id);
  }
  async function refresh(selectCurrent = true) {
    const uploadId = detail.upload.id;
    const version = ++refreshVersion;
    const response = await fetch(`/api/uploads/${uploadId}`);
    if (!response.ok) throw new Error('Could not refresh this file.');
    const result = await response.json();
    if (uploadId !== data.upload.id || version !== refreshVersion) return;
    detail = result;
    if (selectCurrent) selection = 'current';
  }
  async function retry(contextOnly = false) {
    if (retrying) return;
    retrying = true;
    error = '';
    try {
      const response = await fetch(`/api/uploads/${detail.upload.id}/retry`, {
        method: 'POST',
        ...(contextOnly && stage
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ inputRevisionId: stage.id }),
            }
          : {}),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not start processing.');
      notice = contextOnly
        ? 'Visual review queued. Your reviewed source is preserved.'
        : 'Processing queued. Your previous revision remains available.';
      await refresh(false);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not start processing.';
    } finally {
      retrying = false;
    }
  }
  async function cancel() {
    const response = await fetch(`/api/uploads/${detail.upload.id}/cancel`, {
      method: 'POST',
    });
    if (!response.ok) error = 'Could not cancel processing.';
    else {
      notice =
        'Processing canceled. Original files and previous revisions are retained.';
      await refresh(false);
    }
  }
  function duration(ms: number | null | undefined) {
    if (!ms) return '';
    const minutes = Math.floor(ms / 60000);
    return minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : `${minutes} min`;
  }
</script>

<svelte:head
  ><title
    >{stage?.metadata.label || detail.upload.metadata.label} | Chronicler</title
  ></svelte:head
>
<div class="review-header">
  <a class="button-link secondary" href="/" aria-label="Back to staging"
    ><Icon name="arrow-left" />Back</a
  >
  <div class="header-actions">
    <Tooltip text="Open the uploaded file"
      ><a
        class="button-link secondary"
        href={`/api/assets/${detail.asset.id}`}
        target="_blank"
        rel="noreferrer"><Icon name="external" />Original</a
      ></Tooltip
    >
    {#if stage}<Menu label="Export" icon="download">
        <a href={`/api/uploads/${detail.upload.id}/export?revision=${stage.id}`}
          ><Icon name="file" />Markdown</a
        >
        <a
          href={`/api/uploads/${detail.upload.id}/export?revision=${stage.id}&format=json`}
          ><Icon name="file" />JSON</a
        >
        <a
          href={`/api/uploads/${detail.upload.id}/export?revision=${stage.id}&format=zip`}
          ><Icon name="folder" />Offline bundle</a
        >
      </Menu>{/if}
    <Menu label="More" icon="more">
      {#if busy}<button onclick={cancel}>Cancel processing</button>{/if}
      <button disabled={busy || retrying} onclick={() => retry()}
        ><Icon name="refresh" />Reprocess original</button
      >
      {#if stage && (isVideo || stage.document) && current}<button
          disabled={busy || retrying}
          onclick={() => retry(true)}
          ><Icon name="image" />{stage.document
            ? 'Revisit document descriptions'
            : 'Revisit visual context'}</button
        >{/if}
    </Menu>
  </div>
</div>
<div class="heading">
  <div>
    <h1>{stage?.metadata.label || detail.upload.metadata.label}</h1>
    <p class="file-subtitle">
      {isVideo
        ? 'Meeting recording'
        : stage?.document
          ? 'Document'
          : 'Source file'}{stage?.coverage.durationMs
        ? ` / ${duration(stage.coverage.durationMs)}`
        : ''} / Added {new Date(
        detail.upload.metadata.uploadedAt,
      ).toLocaleDateString()}
    </p>
  </div>
  <span class="memory-status"
    ><Icon name="folder" size={15} />{detail.memory.state === 'never_pushed'
      ? 'Not in memory'
      : detail.memory.state.replaceAll('_', ' ')}</span
  >
</div>
<div class="status-row" role="status">
  <span
    class="status-dot"
    class:working={busy}
    class:failed={detail.run.state === 'failed'}
  ></span>
  <strong
    >{busy
      ? 'Processing'
      : detail.run.state === 'failed'
        ? 'Processing paused'
        : 'Ready to review'}</strong
  >
  {#if busy}<span class="muted">{detail.run.progress}</span
    >{:else if stage && !stage.coverage.complete}<span class="review-needed"
      ><Icon name="warning" size={14} />Partial extraction</span
    >{/if}
  {#if stage}<div class="revision-picker">
      <Icon name="history" size={16} /><Select
        label="Revision"
        options={revisions}
        bind:value={selection}
      />
    </div>{/if}
</div>
{#if detail.run.error}<p class="error" role="alert">{detail.run.error}</p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if notice}<p class="notice" role="status">{notice}</p>{/if}
{#if stage}
  <div class="review-layout">
    <aside class="review-sidebar">
      <LineSidebar
        items={sections}
        bind:active={activeSection}
        onselect={navigate}
      />
      <div class="sidebar-note">
        <Icon name="info" size={15} /><span
          >Review here. Publish from Staging.</span
        >
      </div>
    </aside>
    <div class="review-content">
      {#if stage.coverage.warnings.length}<div class="review-notes">
          <Disclosure
            title={`Review notes (${stage.coverage.warnings.length})`}
            icon="warning"
            ><ul>
              {#each stage.coverage.warnings as warning}<li>
                  {warning}
                </li>{/each}
            </ul></Disclosure
          >
        </div>{/if}
      <div class="workspace">
        <section
          class="source card"
          id="original-evidence"
          aria-labelledby="source-heading"
        >
          <div class="panel-heading">
            <div class="panel-title">
              <Icon name={isVideo ? 'video' : 'file'} />
              <h2 id="source-heading">Original evidence</h2>
            </div>
            <span class="source-format"
              >{isVideo
                ? 'VIDEO'
                : stage.document?.format.toUpperCase() || 'FILE'}</span
            >
          </div>
          {#if isVideo}<video controls preload="metadata" bind:this={player}
              ><source src={`/api/assets/${detail.asset.id}`} /><track
                kind="captions"
                src={`/api/uploads/${detail.upload.id}/captions?revision=${stage.id}`}
                label="Original transcript"
              /></video
            >
          {:else if /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(detail.upload.filename)}<a
              class="source-preview"
              href={`/api/assets/${detail.asset.id}`}
              target="_blank"
              rel="noreferrer"
              ><img
                src={`/api/assets/${detail.asset.id}`}
                alt="Original source"
              /></a
            >
          {:else}<a
              class="source-file-preview"
              href={`/api/assets/${detail.asset.id}`}
              target="_blank"
              rel="noreferrer"
              ><Icon name="file" size={42} /><strong
                >{detail.upload.filename}</strong
              ><span><Icon name="external" size={15} />Open original file</span
              ></a
            >{/if}
          <div class="source-footer">
            <span
              ><Icon name="clock" size={14} />{stage.metadata.sourceTime
                ? new Date(stage.metadata.sourceTime).toLocaleString()
                : isVideo
                  ? 'Meeting date not set'
                  : 'Source date not set'}</span
            ><span>{(detail.asset.bytes / 1024 / 1024).toFixed(1)} MB</span>
          </div>
          <Disclosure title="Source details" icon="info"
            ><dl>
              <dt>Uploaded by</dt>
              <dd>{stage.metadata.uploader}</dd>
              <dt>Source model</dt>
              <dd>{stage.provenance.model ?? 'Native text'}</dd>
              <dt>Revision</dt>
              <dd>{stage.id}</dd>
              <dt>Processing</dt>
              <dd>{stage.provenance.adapter}</dd>
            </dl></Disclosure
          >
        </section>
        <TranscriptWorkspace
          bind:this={transcript}
          {stage}
          uploadId={detail.upload.id}
          {isVideo}
          canEdit={current}
          onseek={seek}
          onupdated={() => refresh()}
        />
      </div>
      {#if stage.document}<section id="document-review">
          <DocumentViewer {stage} />
        </section>{:else}<VisualContext
          {stage}
          onseek={seek}
          ontranscript={(id) => transcript?.openTranscript(id)}
        />{/if}
      {#if speakerSuggestions.length}<section class="speaker-notes">
          <Disclosure
            title={`Speaker suggestions (${speakerSuggestions.length})`}
            icon="info"
            ><p class="muted">
              Suggested names are unverified. Original speaker labels stay
              separate.
            </p>
            {#each speakerSuggestions as suggestion}<article>
                <div class="suggestion-heading">
                  <strong>{suggestion.speaker}</strong><span
                    >Possibly {suggestion.candidateName}</span
                  ><span class="badge">{suggestion.confidence}</span>
                </div>
                <p>{suggestion.reason}</p>
                <div class="actions">
                  {#each suggestion.transcriptIds as ref}<button
                      class="secondary small"
                      onclick={() => transcript?.openTranscript(ref)}
                      ><Icon name="transcript" size={14} />Name evidence</button
                    >{/each}
                </div>
              </article>{/each}</Disclosure
          >
        </section>{/if}
    </div>
  </div>
{:else}<section class="card waiting">
    <span class="waiting-icon"
      ><Icon
        name={detail.run.state === 'failed' ? 'warning' : 'transcript'}
        size={32}
      /></span
    >
    <h2>
      {detail.run.state === 'failed'
        ? 'Your original is safe'
        : 'Preparing your review'}
    </h2>
    <p class="muted">
      {detail.run.state === 'failed'
        ? 'Use More to retry processing.'
        : 'You can leave this page. Progress is saved.'}
    </p>
    {#if detail.run.state === 'failed'}<button
        class="secondary"
        disabled={retrying}
        onclick={() => retry()}><Icon name="refresh" />Retry processing</button
      >{/if}
  </section>{/if}

<style>
  .review-header,
  .header-actions,
  .heading,
  .status-row,
  .panel-heading,
  .panel-title,
  .source-footer,
  .suggestion-heading {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .review-header {
    justify-content: space-between;
    margin-bottom: 1.75rem;
  }
  .review-header :global(.button-link),
  .review-header :global(button) {
    font-size: 0.8rem;
  }
  .heading {
    justify-content: space-between;
    align-items: flex-start;
    gap: 2rem;
  }
  h1 {
    max-width: 68rem;
    font-size: clamp(1.9rem, 3.2vw, 3.25rem);
    line-height: 1.13;
    letter-spacing: -0.045em;
    overflow-wrap: anywhere;
  }
  .file-subtitle {
    font-size: 0.82rem;
    color: #787774;
    margin: 0.7rem 0 0;
  }
  .memory-status {
    display: inline-flex;
    gap: 0.45rem;
    align-items: center;
    font-size: 0.75rem;
    color: #787774;
    white-space: nowrap;
    padding-top: 0.6rem;
  }
  .status-row {
    margin: 1.5rem 0 2rem;
    padding: 0.9rem 0;
    border-block: 1px solid #eaeaea;
    flex-wrap: wrap;
    font-size: 0.78rem;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #648468;
  }
  .status-dot.working {
    background: #9b8050;
  }
  .status-dot.failed {
    background: #9f2f2d;
  }
  .review-needed {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: #956400;
  }
  .revision-picker {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    min-width: 12rem;
  }
  .review-layout {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 2rem;
    align-items: start;
  }
  .review-sidebar {
    min-width: 0;
    position: sticky;
    top: 7rem;
    padding-top: 0.5rem;
  }
  .sidebar-note {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    margin: 2.2rem 0.3rem 0;
    font-size: 0.71rem;
    color: #96938c;
    max-width: 9rem;
    line-height: 1.6;
  }
  .sidebar-note :global(svg) {
    flex-shrink: 0;
    margin-top: 0.1rem;
  }
  .review-content {
    min-width: 0;
  }
  .review-notes {
    margin-bottom: 1.25rem;
    background: #fbf3db;
    border-radius: 8px;
    padding: 0.2rem 1rem;
  }
  .review-notes li {
    margin: 0.45rem 0;
    font-size: 0.85rem;
    line-height: 1.6;
  }
  .workspace {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-flow: dense;
    gap: 1rem;
    align-items: stretch;
    margin-bottom: 2rem;
  }
  .source {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .panel-heading {
    justify-content: space-between;
    margin-bottom: 1.1rem;
  }
  .panel-title h2 {
    margin: 0;
    font-size: 1rem;
  }
  .source-format {
    color: #96938c;
    font-size: 0.65rem;
    letter-spacing: 0.08em;
  }
  video,
  .source-preview {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    border-radius: 8px;
    background: #242421;
  }
  .source-preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .source-file-preview {
    display: flex;
    flex: 1;
    min-height: 14rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 1rem;
    background: #f7f6f3;
    color: #65635e;
    border-radius: 8px;
    padding: 1rem;
    overflow-wrap: anywhere;
  }
  .source-file-preview span {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
  }
  .source-footer {
    justify-content: space-between;
    font-size: 0.72rem;
    color: #787774;
    margin: 1rem 0;
  }
  .source-footer span:first-child {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .source :global(.disclosure) {
    margin-top: auto;
  }
  dl {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    gap: 0.65rem;
    font-size: 0.75rem;
  }
  dt {
    color: #787774;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  #original-evidence,
  #document-review {
    scroll-margin-top: 7rem;
  }
  .speaker-notes {
    margin-top: 1.5rem;
  }
  .speaker-notes article {
    padding: 1rem 0;
    border-top: 1px solid #eaeaea;
  }
  .speaker-notes p {
    font-size: 0.85rem;
  }
  .suggestion-heading {
    flex-wrap: wrap;
    font-size: 0.85rem;
  }
  .small {
    font-size: 0.75rem;
  }
  .waiting {
    min-height: 24rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin: 2rem 0;
    text-align: center;
  }
  .waiting-icon {
    display: grid;
    place-items: center;
    width: 4rem;
    height: 4rem;
    border-radius: 12px;
    color: #65635e;
    background: #f7f6f3;
    margin-bottom: 1.4rem;
  }
  @media (max-width: 1100px) {
    .review-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 1rem;
    }
    .review-sidebar {
      position: static;
    }
    .sidebar-note {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .workspace {
      grid-template-columns: 1fr;
    }
    .heading {
      flex-direction: column;
      gap: 0.5rem;
    }
    .memory-status {
      padding: 0;
    }
    .review-header {
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .header-actions {
      gap: 0.4rem;
    }
    .revision-picker {
      margin-left: 0;
      width: 100%;
    }
    .status-row {
      margin-bottom: 1rem;
    }
  }
</style>
