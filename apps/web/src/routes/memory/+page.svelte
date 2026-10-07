<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  let { data } = $props();
  const link = (id: string, versionId?: string) =>
    `/memory/nodes/${id}?knownVersion=${data.memory.version}${versionId ? `&versionId=${versionId}` : ''}`;
  onMount(() => {
    const timer = setInterval(() => {
      if (!page.url.searchParams.has('knownVersion')) invalidateAll();
    }, 5000);
    return () => clearInterval(timer);
  });
</script>

<h1>Research memory</h1>
<p class="muted">
  Version {data.memory.version} · {data.memory.projects.length} projects · {data
    .memory.topics.length} topics · {data.memory.sources.length} sources · {data
    .memory.segments.length} segments
</p>
<p>
  Start with a summary, then open the discussion and its original evidence. <a
    href="/memory/assertions">Compare earlier assertion memory</a
  >
</p>
<form class="card filters" method="GET">
  <label
    >Recorded knowledge<select
      name="knownVersion"
      value={page.url.searchParams.get('knownVersion') ?? ''}
      ><option value="">Latest</option>{#each data.memory.commits as c}<option
          value={c.version}>Version {c.version}</option
        >{/each}<option value="0">Before any pushes</option></select
    ></label
  >
  <label
    >Search summaries and source text<input
      name="q"
      placeholder="Topic, method, number or original wording"
      value={page.url.searchParams.get('q') ?? ''}
    /></label
  ><button>Apply</button>
</form>
{#if data.search}<section class="card">
    <h2>Search results</h2>
    <p class="muted">
      {data.search.total} matches{data.search.truncated
        ? ' · Showing first 20'
        : ''}
    </p>
    {#each data.search.hits as hit}<article>
        <span class="badge"
          >{hit.kind}{hit.sourceMatched ? ' · Matched original text' : ''}</span
        >
        <h3><a href={link(hit.nodeId, hit.versionId)}>{hit.title}</a></h3>
        <p>{hit.summary}</p>
        {#each hit.matches as match}<blockquote>{match.text}</blockquote>{/each}
      </article>{/each}
  </section>{/if}
<section>
  <h2>Projects and topics</h2>
  <p class="muted">
    Continuing research across sources. Each topic opens the same segments shown
    in the source view.
  </p>
  {#if !data.memory.projects.length}<div class="card">
      <p>
        No organized projects in this snapshot. Select reviewed <a href="/"
          >staging files</a
        > and push them to memory.
      </p>
    </div>{/if}
  <div class="projects">
    {#each data.memory.projects as project}<article class="card">
        <span class="badge">Project · {project.children.length} topics</span>
        <h2><a href={link(project.id)}>{project.current.title}</a></h2>
        <p class="preview">{project.current.summary}</p>
        <a href={link(project.id)}>Read project summary</a>
        <ul>
          {#each project.children as child}{@const topic =
              data.memory.topics.find(
                (t) => t.id === child.nodeId,
              )}{#if topic}<li>
                <a href={link(topic.id, child.versionId)}
                  >{topic.current.title}</a
                >
                <span class="muted">· {topic.children.length} discussions</span>
              </li>{/if}{/each}
        </ul>
      </article>{/each}
  </div>
</section>
<section>
  <h2>Sources and segments</h2>
  <p class="muted">
    Source order and exact coverage are preserved, including discussions without
    a project assignment.
  </p>
  <div class="sources">
    {#each data.memory.sources as source}<article class="card">
        <span class="badge">Source · {source.children.length} segments</span>
        <h3><a href={link(source.id)}>{source.current.title}</a></h3>
        <p class="preview">{source.current.summary}</p>
        <a href={link(source.id)}>Read source summary</a>
        <details>
          <summary>Discussion outline</summary>
          <ol>
            {#each source.children as child}{@const segment =
                data.memory.segments.find(
                  (s) => s.id === child.nodeId,
                )}{#if segment}<li>
                  <a href={link(segment.id, child.versionId)}
                    >{segment.current.title}</a
                  >{segment.current.segment?.contextOnly ? ' · Context' : ''}
                </li>{/if}{/each}
          </ol>
        </details>
      </article>{/each}
  </div>
</section>
<section class="card">
  <h2>Push history</h2>
  {#each data.pushes as push}<p>
      <a href={`/pushes/${push.id}`}
        >{new Date(push.createdAt).toLocaleString()}</a
      >
      · {push.state} · {push.progress}
    </p>{/each}
</section>

<style>
  section {
    margin: 28px 0;
  }
  .filters {
    display: flex;
    gap: 16px;
    align-items: end;
    flex-wrap: wrap;
  }
  .filters label {
    display: grid;
    gap: 8px;
  }
  .filters input {
    min-width: 340px;
  }
  .projects {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 18px;
  }
  .sources {
    display: grid;
    gap: 16px;
  }
  select {
    font: inherit;
    padding: 10px;
    border: 1px solid #ccd6e2;
    border-radius: 6px;
  }
  .preview {
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  article p {
    white-space: pre-wrap;
  }
  li {
    margin: 10px 0;
  }
  blockquote {
    font-size: 14px;
    border-left: 3px solid #ccd6e2;
    padding-left: 16px;
    max-height: 160px;
    overflow: auto;
  }
  details {
    margin-top: 14px;
  }
</style>
