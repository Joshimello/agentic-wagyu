<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ProcessingDetails } from '../server/services/processing';
  import Disclosure from './Disclosure.svelte';
  import Icon from './Icon.svelte';
  import { processingMayResume } from '../processing-status';

  let {
    uploadId,
    runId,
    state: runState,
  }: { uploadId: string; runId: string; state: string } = $props();
  let expanded = $state(false);
  let details = $state<ProcessingDetails | null>(null);
  let selected = $state('');
  let loading = $state(false);
  let error = $state('');
  let notice = $state('');
  let version = 0;
  let controller: AbortController | undefined;
  let current = $derived(
    details?.runs.find((run) => run.id === details?.selectedRunId),
  );
  let output = $derived(
    details
      ? [
          `Source: ${details.filename}`,
          `Run: ${details.selectedRunId}`,
          `State: ${current?.state} | Attempt: ${current?.attempts} | Progress: ${current?.progressPercent}%`,
          `Last stage: ${current?.progress}`,
          ...(current?.retryPending
            ? ['An automatic retry is queued. Completed work will be reused.']
            : []),
          ...details.events.map(
            (event) =>
              `${event.timestamp} [${event.level.toUpperCase()}] attempt ${event.attempt}: ${event.message}${event.percent === undefined ? '' : ` (${event.percent}%)`}`,
          ),
          ...(!details.events.length
            ? ['Detailed progress logging was unavailable for this older run.']
            : []),
          ...(details.failure
            ? [
                '',
                `${current?.state === 'failed' ? 'Failure' : 'Earlier failure'} (${details.failureSource}):`,
                `${details.failure.type} / ${details.failure.code}: ${details.failure.message}`,
                details.failure.stack,
              ]
            : []),
        ].join('\n')
      : '',
  );

  async function load() {
    const requestVersion = ++version;
    controller?.abort();
    controller = new AbortController();
    loading = true;
    error = '';
    try {
      const query = selected ? `?runId=${encodeURIComponent(selected)}` : '';
      const response = await fetch(
        `/api/uploads/${uploadId}/processing${query}`,
        { signal: controller.signal },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? 'Processing details are unavailable');
      if (requestVersion === version) details = result;
    } catch (failure) {
      if (
        requestVersion === version &&
        !(failure instanceof DOMException && failure.name === 'AbortError')
      )
        error =
          failure instanceof Error
            ? failure.message
            : 'Processing details are unavailable';
    } finally {
      if (requestVersion === version) loading = false;
    }
  }
  $effect(() => {
    const opened = expanded;
    runId;
    if (opened)
      untrack(() => {
        selected = '';
        details = null;
        void load();
      });
    return () => {
      version++;
      controller?.abort();
    };
  });
  onMount(() => {
    const timer = setInterval(() => {
      const followingCurrent = !selected || selected === runId;
      if (
        expanded &&
        !loading &&
        ((current &&
          processingMayResume(
            current.state,
            current.updatedAt,
            undefined,
            current.retryPending,
          )) ||
          (followingCurrent && ['queued', 'processing'].includes(runState)))
      )
        void load();
    }, 5000);
    return () => {
      clearInterval(timer);
      version++;
      controller?.abort();
    };
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      notice = 'Processing log copied.';
    } catch {
      notice = 'Clipboard is unavailable. Download the log instead.';
    }
  }
  function download() {
    const link = document.createElement('a');
    const url = URL.createObjectURL(
      new Blob([output], { type: 'text/plain;charset=utf-8' }),
    );
    link.href = url;
    link.download = `processing-${details?.selectedRunId ?? runId}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<section class="processing-details" aria-label="Processing details">
  <Disclosure title="Processing details" icon="history" bind:open={expanded}>
    <p class="muted">
      Review attempts, saved work, and the error reported by the worker.
      Completed audio windows resume automatically; an unfinished window
      restarts.
    </p>
    <div class="details-toolbar">
      {#if details}<label
          >Processing run
          <select
            aria-label="Processing run"
            value={details.selectedRunId}
            onchange={(event) => {
              selected = event.currentTarget.value;
              void load();
            }}
          >
            {#each details.runs as run}<option value={run.id}
                >{new Date(run.createdAt).toLocaleString()} / {run.state} / {run.id.slice(
                  0,
                  8,
                )}</option
              >{/each}
          </select>
        </label>{/if}
      <button class="secondary small" disabled={loading} onclick={load}
        ><Icon name="refresh" size={14} />Refresh details</button
      >
      {#if details}<button class="secondary small" onclick={copy}
          ><Icon name="copy" size={14} />Copy log</button
        >
        <button class="secondary small" onclick={download}
          ><Icon name="download" size={14} />Download log</button
        >{/if}
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    {#if loading && !details}<p role="status">
        Loading processing details...
      </p>{/if}
    {#if details}
      <div class="processing-facts">
        <span
          ><strong>{details.cachedWindows.length}</strong> cached audio {details
            .cachedWindows.length === 1
            ? 'window'
            : 'windows'}</span
        >
        {#if details.live}<span
            >Media stage: <strong
              >{details.live.stage.replaceAll('_', ' ')}</strong
            ></span
          >
          <span
            >{Math.floor(details.live.coveredMs / 60000)} / {details.live
              .durationMs === null
              ? '?'
              : Math.ceil(details.live.durationMs / 60000)} min of this window</span
          >
          <span
            >{details.live.generatedTokens.toLocaleString()} generated tokens</span
          >{/if}
      </div>
      {#if details.failure}<p class="failure-guidance">
          {current?.retryPending
            ? 'An automatic retry is queued and will reuse completed work.'
            : details.failure.retryable
              ? 'A retry can reuse completed work. If the same error repeats, use this log to identify the failing stage.'
              : 'This source or request was rejected. Check the error and original file before retrying.'}
        </p>{/if}
      <textarea
        class="processing-log"
        aria-label="Processing log"
        rows="16"
        readonly
        value={output}></textarea>
    {/if}
  </Disclosure>
</section>

<style>
  .processing-details {
    margin: 0.8rem 0 1.5rem;
    min-width: 0;
  }
  .processing-details p {
    font-size: 0.8rem;
    line-height: 1.65;
  }
  .details-toolbar {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin: 0.8rem 0;
  }
  .details-toolbar label {
    font-size: 0.75rem;
    flex: 1;
    min-width: 12rem;
  }
  .details-toolbar select {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
  }
  .processing-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    font-size: 0.78rem;
    color: var(--muted);
    margin: 1rem 0;
  }
  .failure-guidance {
    color: var(--muted);
  }
  .processing-log {
    width: 100%;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--canvas);
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 26rem;
    overflow: auto;
    margin: 0.8rem 0 0;
  }
  @media (max-width: 700px) {
    .details-toolbar label {
      flex-basis: 100%;
      min-width: 0;
    }
  }
</style>
