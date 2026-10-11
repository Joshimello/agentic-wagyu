<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Stage } from '../server/contracts';
  import type { SummaryStatus } from '../server/contracts/summaries';
  import Icon from './Icon.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import { useActivity } from '../ui/activity.svelte';
  let {
    stage,
    uploadId,
    removed = false,
    ontranscript,
  }: {
    stage: Stage;
    uploadId: string;
    removed?: boolean;
    ontranscript: (id: string) => void;
  } = $props();
  const activity = useActivity();
  let status = $state<SummaryStatus | null>(null);
  let loading = $state(false);
  let changing = $state(false);
  let error = $state('');
  let version = 0;
  let disposed = false;
  let reading = false;
  let topicIndex = $state(0);
  let expanded = $state(false);
  let summaryText = $state<HTMLDivElement>();
  let canExpand = $state(false);
  let topic = $derived(status?.summary?.topics[topicIndex]);
  const uniqueId = $props.id();
  function navigateTopic(event: KeyboardEvent, index: number) {
    const count = status?.summary?.topics.length ?? 0;
    let next = index;
    if (['ArrowRight', 'ArrowDown'].includes(event.key))
      next = (index + 1) % count;
    else if (['ArrowLeft', 'ArrowUp'].includes(event.key))
      next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;
    event.preventDefault();
    topicIndex = next;
    (
      (event.currentTarget as HTMLElement).parentElement?.children[
        next
      ] as HTMLElement
    )?.focus();
  }
  let busy = $derived(
    status && ['queued', 'processing'].includes(status.state),
  );
  let hasSpeech = $derived(
    stage.primitives.some(
      (p) => p.kind === 'text' && p.role === 'asr' && p.text.trim(),
    ),
  );
  async function read(revisionId: string, initialize = false) {
    if (reading && !initialize) return;
    reading = true;
    const request = ++version;
    if (initialize) {
      topicIndex = 0;
      expanded = false;
      status = null;
      error = '';
      loading = true;
    }
    try {
      const response = await fetch(
        `/api/uploads/${uploadId}/summary?revision=${revisionId}`,
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not load summary');
      if (disposed || request !== version || stage.id !== revisionId) return;
      status = result;
      if (
        initialize &&
        result.state === 'not_requested' &&
        !removed &&
        hasSpeech
      )
        await generate();
    } catch (e) {
      if (!disposed && request === version)
        error = e instanceof Error ? e.message : 'Could not load summary';
    } finally {
      reading = false;
      if (request === version) loading = false;
    }
  }
  async function generate() {
    if (changing || removed || !hasSpeech) return;
    const revisionId = stage.id;
    const request = ++version;
    changing = true;
    error = '';
    try {
      const response = await fetch(`/api/uploads/${uploadId}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not summarize meeting');
      if (!disposed && request === version && revisionId === stage.id)
        status = result;
      await activity.refresh();
    } catch (e) {
      if (!disposed && request === version)
        error = e instanceof Error ? e.message : 'Could not request summary';
    } finally {
      if (request === version) {
        changing = false;
        loading = false;
      }
    }
  }
  async function cancel() {
    if (!status?.id || changing) return;
    const revisionId = stage.id,
      summaryId = status.id,
      request = ++version;
    changing = true;
    error = '';
    try {
      const response = await fetch(`/api/uploads/${uploadId}/summary/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summaryId, generation: status.generation }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not cancel summary');
      if (!disposed && request === version && revisionId === stage.id)
        status = result;
      await activity.refresh();
    } catch (e) {
      if (!disposed && request === version)
        error = e instanceof Error ? e.message : 'Could not cancel summary';
    } finally {
      if (request === version) changing = false;
    }
  }
  $effect(() => {
    const text = summaryText;
    if (!text) return;
    const measure = () => {
      canExpand =
        text.scrollHeight >
        parseFloat(getComputedStyle(text).lineHeight) * 15 + 1;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    measure();
    return () => observer.disconnect();
  });
  $effect(() => {
    const revisionId = stage.id;
    untrack(() => {
      changing = false;
      if (hasSpeech) void read(revisionId, true);
    });
  });
  onMount(() => {
    const timer = setInterval(() => {
      if (busy && !changing && !document.hidden) void read(stage.id);
    }, 1500);
    return () => {
      disposed = true;
      ++version;
      clearInterval(timer);
    };
  });
</script>

<section
  class="card meeting-summary"
  id="meeting-summary"
  aria-labelledby="meeting-summary-title"
>
  <div class="summary-heading">
    <div>
      <Icon name="file" />
      <h2 id="meeting-summary-title">Meeting summary</h2>
    </div>
    {#if status?.state === 'ready'}<span class="summary-label">Overview</span
      >{/if}
  </div>
  {#if !stage.coverage.complete}<p class="partial-note">
      <Icon name="warning" size={14} />Based on the available transcript
    </p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if status?.state === 'ready' && status.summary}
    <div
      class="summary-copy summary-excerpt"
      class:collapsed={!expanded}
      id={`${uniqueId}-summary-copy`}
    >
      <div bind:this={summaryText}>
        <p class="overview">{status.summary.overview.text}</p>
        {#if status.summary.highlights.length}<ul class="highlights">
            {#each status.summary.highlights as point}<li>
                {point.text}
              </li>{/each}
          </ul>{/if}
      </div>
    </div>
    {#if canExpand}<button
        class="secondary small summary-toggle"
        aria-expanded={expanded}
        aria-controls={`${uniqueId}-summary-copy`}
        onclick={() => (expanded = !expanded)}
      >
        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
        />{expanded ? 'Show less' : 'Show more'}
      </button>{/if}
    {#if status.summary.topics.length}<h3 class="topics-label">
        Topics and projects
      </h3>
      <div class="topics-layout">
        <div class="topic-tabs" role="tablist" aria-label="Topics and projects">
          {#each status.summary.topics as item, index}<button
              class="secondary topic-tab"
              role="tab"
              id={`${uniqueId}-topic-${index}`}
              aria-selected={topicIndex === index}
              aria-controls={`${uniqueId}-topic-panel`}
              tabindex={topicIndex === index ? 0 : -1}
              onclick={() => (topicIndex = index)}
              onkeydown={(event) => navigateTopic(event, index)}
              >{item.title}</button
            >{/each}
        </div>
        {#if topic}<div
            class="topic-summary"
            role="tabpanel"
            id={`${uniqueId}-topic-panel`}
            aria-labelledby={`${uniqueId}-topic-${topicIndex}`}
            tabindex="0"
          >
            <span class="topic-kind"
              >{topic.kind === 'project' ? 'Project' : 'Topic'}</span
            >
            <p class="summary-copy">{topic.summary}</p>
            <button
              class="secondary small"
              onclick={() => ontranscript(topic.evidenceIds[0])}
              ><Icon name="transcript" size={13} />Source</button
            >
          </div>{/if}
      </div>
    {/if}
  {:else if busy || loading}<div class="summary-waiting">
      <ProgressBar
        value={status?.progressPercent ?? null}
        label={status?.state === 'queued'
          ? 'Queued'
          : 'Summarizing the meeting'}
        ariaLabel="Meeting summary progress"
        state={status?.state ?? 'processing'}
      />
      {#if busy}<button
          class="secondary small"
          disabled={changing}
          onclick={cancel}
          ><Icon name="close" size={14} />{changing
            ? 'Stopping...'
            : 'Cancel'}</button
        >{/if}
    </div>
  {:else}<div class="summary-empty">
      <p>
        {!hasSpeech
          ? 'No spoken content is available yet.'
          : status?.state === 'canceled'
            ? 'Summary canceled. Completed reading is saved.'
            : status?.state === 'failed'
              ? status.error || 'Summary could not finish.'
              : 'A concise overview of this meeting.'}
      </p>
      {#if hasSpeech && !removed}<button
          class="secondary"
          disabled={changing}
          onclick={generate}
          ><Icon name="refresh" />{status?.state === 'canceled'
            ? 'Resume summary'
            : status?.state === 'failed'
              ? 'Retry summary'
              : 'Summarize meeting'}</button
        >{/if}
    </div>{/if}
</section>

<style>
  .meeting-summary {
    min-width: 0;
    margin-bottom: 2rem;
  }
  .summary-heading,
  .summary-heading > div {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  .summary-heading {
    justify-content: space-between;
    margin-bottom: 1.1rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .summary-label,
  .topic-kind {
    font-size: 0.65rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .summary-copy {
    font-size: 0.86rem;
    line-height: 1.75;
    overflow-wrap: anywhere;
  }
  .summary-excerpt.collapsed {
    max-height: calc(15 * 1.75em);
    overflow: hidden;
  }
  .summary-toggle {
    margin-top: 0.7rem;
  }
  .topics-layout {
    display: grid;
    grid-template-columns: minmax(9rem, 0.35fr) minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
    border-top: 1px solid var(--border);
    margin-top: 0.7rem;
    padding-top: 0.8rem;
  }
  .overview {
    margin: 0 0 1rem;
  }
  .highlights {
    padding-left: 1.15rem;
    margin: 0 0 1.2rem;
  }
  .highlights li + li {
    margin-top: 0.55rem;
  }
  .topic-summary {
    min-width: 0;
  }
  .topic-tabs {
    display: flex;
    flex-wrap: wrap;
    align-content: start;
    align-items: start;
    gap: 0.35rem;
    margin: 0;
  }
  .topic-tab {
    font-size: 0.72rem;
    padding: 0.35rem 0.55rem;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .topic-tab[aria-selected='true'] {
    color: var(--accent);
    background: var(--blue-soft);
    border-color: #d1e1fa;
  }
  .topics-label {
    margin-top: 0.9rem;
  }
  h3 {
    margin: 0;
    font-size: 0.88rem;
  }
  .topic-summary p {
    margin: 0.4rem 0 0.65rem;
  }
  .topic-summary button {
    font-size: 0.68rem;
    padding: 0.3rem 0.5rem;
  }
  .summary-waiting {
    display: grid;
    gap: 0.9rem;
    padding: 1.4rem 0;
    justify-items: start;
  }
  .summary-empty {
    color: var(--muted);
    font-size: 0.84rem;
    padding: 0.8rem 0;
  }
  .partial-note {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.7rem;
    color: var(--yellow-ink);
    margin: -0.4rem 0 1rem;
  }
  .error {
    font-size: 0.8rem;
  }
  @media (max-width: 600px) {
    .topics-layout {
      grid-template-columns: minmax(6rem, 0.4fr) minmax(0, 1fr);
      gap: 0.75rem;
    }
  }
</style>
