<script lang="ts">
  import Icon from '../lib/components/Icon.svelte';
  import { shortDate } from '../lib/dates';
  let { data } = $props();
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<svelte:head><title>Projects | Chronicler</title></svelte:head>
<div class="heading">
  <h1>Projects</h1>
  <a class="button-link" href="/sources"
    ><Icon name="upload" size={17} />Add a meeting</a
  >
</div>
{#if !data.projects.length}
  <section class="card empty">
    <h2>No projects yet</h2>
    <ol>
      <li><strong>Upload</strong> a recording, slides or a document.</li>
      <li><strong>Check</strong> the transcript.</li>
      <li><strong>Add it to a project</strong>, then ask questions.</li>
    </ol>
    <a class="button-link" href="/sources"
      >{data.sources ? 'Open your sources' : 'Upload your first file'}</a
    >
  </section>
{/if}
<div class="projects">
  {#each data.projects as project}
    <a class="card project" href={`/memory/nodes/${project.id}`}>
      <span class="thumb">
        {#if project.thumbnail}<video
            src={`/api/assets/${project.thumbnail}#t=4`}
            preload="metadata"
            muted
            playsinline
            tabindex="-1"
            aria-hidden="true"
          ></video>{:else}<Icon name="folder" size={30} />{/if}
      </span>
      <span class="body">
      <span class="title">
        <h2>{project.title}</h2>
        {#if project.toReview}<span class="badge review"
            >{project.toReview} to review</span
          >{/if}
      </span>
      <p class="summary">{project.summary}</p>
      <span class="stats">
        <span><Icon name="video" size={14} />{plural(project.meetings, 'meeting')}</span>
        <span><Icon name="success" size={14} />{plural(project.decisions, 'decision')}</span>
        <span><Icon name="list" size={14} />{plural(project.commitments, 'commitment')}</span>
        {#if project.lastMeeting}<span
            ><Icon name="clock" size={14} />{shortDate(project.lastMeeting)}</span
          >{/if}
      </span>
      </span>
    </a>
  {/each}
</div>

<style>
  .heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.4rem;
  }
  h1 {
    margin: 0;
  }
  .projects {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 24rem), 1fr));
    gap: 1rem;
  }
  .project {
    display: flex;
    align-items: stretch;
    gap: 1.1rem;
    color: var(--ink);
    transition:
      border-color 150ms,
      transform 200ms var(--ease-out);
  }
  .project:hover {
    text-decoration: none;
    border-color: var(--ink);
    transform: translateY(-2px);
  }
  .title {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.8rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .review {
    background: var(--yellow-soft);
    color: var(--yellow-ink);
    flex: none;
  }
  .summary {
    margin: 0;
    color: var(--muted);
    font-size: 0.88rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.1rem;
    color: var(--muted);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    max-width: 34rem;
  }
  .empty ol {
    margin: 0.8rem 0 1.2rem;
    padding-left: 1.2rem;
    color: var(--muted);
    display: grid;
    gap: 0.3rem;
  }
  .empty strong {
    color: var(--ink);
    font-weight: 500;
  }
  .thumb {
    flex: none;
    width: 9.5rem;
    aspect-ratio: 16 / 10;
    align-self: flex-start;
    border-radius: 8px;
    overflow: hidden;
    background: var(--canvas);
    border: 1px solid var(--border);
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    transition: transform 300ms var(--ease-out);
  }
  .project:hover .thumb video {
    transform: scale(1.03);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .stats span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  @media (max-width: 560px) {
    .project {
      flex-direction: column;
    }
    .thumb {
      width: 100%;
    }
  }
</style>
