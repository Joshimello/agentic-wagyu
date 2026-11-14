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
      <span class="title">
        <h2>{project.title}</h2>
        {#if project.toReview}<span class="badge review"
            >{project.toReview} to review</span
          >{/if}
      </span>
      <p class="summary">{project.summary}</p>
      <span class="stats">
        <span>{plural(project.meetings, 'meeting')}</span>
        <span>{plural(project.decisions, 'decision')}</span>
        <span>{plural(project.commitments, 'commitment')}</span>
        {#if project.lastMeeting}<span
            >Last met {shortDate(project.lastMeeting)}</span
          >{/if}
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
    flex-direction: column;
    gap: 0.7rem;
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
    gap: 0.3rem 1.1rem;
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
</style>
