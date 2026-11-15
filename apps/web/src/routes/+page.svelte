<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Icon from '../lib/components/Icon.svelte';
  import Menu from '../lib/components/Menu.svelte';
  import { askAbout, askInPanel, nextMeetingQuestion } from '../lib/ui/ask.svelte';
  import { shortDate } from '../lib/dates';
  let { data } = $props();
  let undo = $state<{ id: string; title: string } | null>(null),
    error = $state('');
  // Removing only hides the project; memory and evidence stay, so it can be undone.
  async function setHidden(project: { id: string; title: string }, hidden: boolean) {
    error = '';
    try {
      const response = await fetch(`/api/projects/${project.id}/hidden`, {
        method: hidden ? 'POST' : 'DELETE',
      });
      if (!response.ok) throw new Error();
      undo = hidden ? { id: project.id, title: project.title } : null;
      await invalidateAll();
    } catch {
      error = `Could not ${hidden ? 'remove' : 'restore'} ${project.title}.`;
    }
  }
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
{#if undo}<p class="notice undo" role="status">
    Removed {undo.title}. Its meetings are still in Sources.<button
      class="secondary small"
      onclick={() => undo && setHidden(undo, false)}>Undo</button
    >
  </p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if !data.projects.length && !data.removed.length}
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
    <article class="card project">
      <a
        class="cover"
        href={`/memory/nodes/${project.id}`}
        aria-label={`Open ${project.title}`}
      ></a>
      <span class="thumb">
        {#if project.picture}<img
            src={`/api/assets/${project.picture}`}
            alt=""
            decoding="async"
          />{:else if project.thumbnail}<video
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
        <span class="more">
          <Menu label={`Options for ${project.title}`} icon="more" compact>
            <button onclick={() => askAbout(project.id)}
              ><Icon name="help" size={15} />Ask about this project</button
            >
            <button onclick={() => askInPanel(nextMeetingQuestion, project.id)}
              ><Icon name="list" size={15} />Prepare next meeting</button
            >
            <a href={`/memory/map?project=${project.id}`}
              ><Icon name="history" size={15} />Open memory</a
            >
            <a href={`/changes?project=${project.id}`}
              ><Icon name="refresh" size={15} />See changes</a
            >
            <a href="/sources"
              ><Icon name="upload" size={15} />Add a meeting</a
            >
            <hr />
            <button class="danger" onclick={() => setHidden(project, true)}
              ><Icon name="trash" size={15} />Remove project</button
            >
          </Menu>
        </span>
      </span>
      {#if project.toReview}<a
          class="badge review"
          href={`/changes?project=${project.id}`}
          >{project.toReview} to review</a
        >{/if}
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
    </article>
  {/each}
</div>
{#if data.removed.length}
  <details class="removed">
    <summary>Removed projects ({data.removed.length})</summary>
    {#each data.removed as project}
      <p>
        <span>{project.title}</span><button
          class="secondary small"
          onclick={() => setHidden(project, false)}>Restore</button
        >
      </p>
    {/each}
  </details>
{/if}

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
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 1.1rem;
    color: var(--ink);
    transition:
      border-color 150ms,
      transform 200ms var(--ease-out);
  }
  .project:hover,
  .project:focus-within {
    border-color: var(--ink);
    transform: translateY(-2px);
  }
  /* The whole card opens the project; the menu and badge sit above the link. */
  .cover {
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .more,
  a.review {
    position: relative;
    z-index: 1;
  }
  .more {
    flex: none;
    margin: -0.3rem -0.4rem 0 0;
  }
  a.review {
    align-self: flex-start;
  }
  a.review:hover {
    text-decoration: none;
    filter: brightness(0.96);
  }
  .undo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .removed {
    margin-top: 1.6rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .removed summary {
    cursor: pointer;
    width: fit-content;
  }
  .removed p {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    max-width: 30rem;
    margin: 0.6rem 0 0;
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
  .thumb img,
  .thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    transition: transform 300ms var(--ease-out);
  }
  .project:hover .thumb img,
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
