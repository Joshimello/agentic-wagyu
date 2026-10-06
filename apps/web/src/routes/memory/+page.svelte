<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import MemoryGraph from '../../lib/components/MemoryGraph.svelte';
  let { data } = $props();
  let memory = $state(untrack(() => data.memory));
  let pushes = $state(untrack(() => data.pushes));
  let selected = $state('');
  let showHistory = $state(false);
  let projectId = $state(page.url.searchParams.get('projectId') ?? '');
  let knownVersion = $state(page.url.searchParams.get('knownVersion') ?? '');
  let effectiveDate = $state(page.url.searchParams.get('effectiveDate') ?? '');
  let error = $state('');
  let statement = $derived(memory.statements.find((s) => s.id === selected));
  let visible = $derived(
    memory.statements.filter(
      (s) => showHistory || ['active', 'conflicted'].includes(s.status),
    ),
  );
  $effect(() => {
    memory = data.memory;
    pushes = data.pushes;
  });
  onMount(() => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/memory${page.url.search}`);
        if (response.ok) memory = await response.json();
        const p = await fetch('/api/pushes');
        if (p.ok) pushes = await p.json();
      } catch {}
    }, 3000);
    return () => clearInterval(timer);
  });
</script>

<h1>Research memory</h1>
<p class="muted">
  Version {memory.version} · {memory.projects.length} projects · {visible.length}
  visible assertions. Source reports remain attributed evidence.
</p>
<form class="card filters" method="GET">
  <label
    >Project<select name="projectId" bind:value={projectId}
      ><option value="">All projects</option
      >{#each data.memory.projects as project}<option value={project.id}
          >{project.name}</option
        >{/each}</select
    ></label
  ><label
    >Recorded knowledge<select name="knownVersion" bind:value={knownVersion}
      ><option value="">Latest</option>{#each memory.commits as commit}<option
          value={commit.version}
          >Version {commit.version} · {new Date(
            commit.createdAt,
          ).toLocaleString()}</option
        >{/each}<option value="0">Before any pushes</option></select
    ></label
  ><label
    >Effective as of (optional)<input
      type="date"
      name="effectiveDate"
      bind:value={effectiveDate}
    /></label
  ><button>Apply view</button>
</form>
{#if error}<p class="error">{error}</p>{/if}
{#if !memory.projects.length}<section class="card">
    <h2>Memory starts with an explicit push</h2>
    <p>
      Select reviewed files in <a href="/">staging</a> and push them to memory.
    </p>
  </section>{:else}
  <section class="card">
    <h2>Memory graph</h2>
    <MemoryGraph {memory} onSelect={(id) => (selected = id)} />
  </section>
  <section class="projects">
    {#each memory.projects as project}<article class="card">
        <h2>{project.name}</h2>
        <p>{project.description}</p>
        <a href={`/memory?projectId=${project.id}`}>Focus this project</a>
      </article>{/each}
  </section>
  <section class="card">
    <h2>Assertions and progress</h2>
    <label class="history"
      ><input type="checkbox" bind:checked={showHistory} />Show superseded,
      withdrawn and future assertions</label
    >
    <div class="assertions">
      {#each visible as item}<button
          class="assertion secondary"
          onclick={() => (selected = item.id)}
          ><span class="badge">{item.type} · {item.status}</span><span
            >{item.current.text}</span
          ><small
            >{item.current.effectiveDate ?? 'Event date unknown'} · {item
              .history.length} recorded versions · {item.evidence.length} active evidence
            links</small
          ></button
        >{/each}
    </div>
  </section>
{/if}
{#if statement}<section class="card detail" id="statement-detail">
    <h2>{statement.type} · {statement.status}</h2>
    <p>{statement.current.text}</p>
    <pre>{JSON.stringify(statement.current.arguments, null, 2)}</pre>
    <h3>Evidence</h3>
    {#each statement.evidence as evidence}<p>
        <a
          href={`/evidence/${evidence.revisionId}/${evidence.primitiveId}?knownVersion=${memory.version}`}
          >Open source {evidence.primitiveId.slice(0, 8)}</a
        >
      </p>{/each}
    <h3>Recorded history</h3>
    {#each statement.history as version}<article>
        <span class="badge">Memory version {version.commitVersion}</span>
        <p>{version.text}</p>
        <p class="muted">
          Effective {version.effectiveDate ?? 'date unknown'} · {version.model} ·
          {version.promptVersion}
        </p>
        {#each version.evidence as evidence}<a
            href={`/evidence/${evidence.revisionId}/${evidence.primitiveId}?knownVersion=${memory.version}`}
            >Historical source {evidence.primitiveId.slice(0, 8)}</a
          >
        {/each}
      </article>{/each}
    {#each memory.relations.filter( (r) => statement?.history.some((v) => v.id === r.fromVersionId || v.id === r.toVersionId) ) as relation}<p
        class:warning={relation.kind === 'conflict'}
      >
        {relation.kind} · {relation.reason}
      </p>{/each}
  </section>{/if}
<section class="card">
  <h2>Push history</h2>
  {#if !pushes.length}<p class="muted">
      No pushes yet.
    </p>{/if}{#each pushes as push}<p>
      <a href={`/pushes/${push.id}`}
        >{new Date(push.createdAt).toLocaleString()}</a
      >
      · {push.state}{push.commitVersion !== null
        ? ` · Memory ${push.commitVersion}`
        : ''} · {push.progress}
    </p>{/each}
</section>

<style>
  section,
  .projects {
    margin: 22px 0;
  }
  .filters {
    display: flex;
    gap: 14px;
    align-items: end;
    flex-wrap: wrap;
  }
  select {
    font: inherit;
    padding: 10px;
    border: 1px solid #ccd6e2;
    border-radius: 6px;
    max-width: 350px;
  }
  .projects {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
  }
  .history {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .assertions {
    display: grid;
    gap: 8px;
    margin-top: 18px;
  }
  .assertion {
    display: grid;
    gap: 8px;
    text-align: left;
    font-weight: 400;
  }
  .assertion small {
    color: #66768b;
  }
  article {
    padding: 12px 0;
    border-top: 1px solid #edf0f4;
  }
  .projects article {
    padding: 24px;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 12px;
  }
</style>
