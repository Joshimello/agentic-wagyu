<script lang="ts">
  import type { memoryView } from '../server/services/memory';
  let {
    memory,
    onSelect,
  }: {
    memory: Awaited<ReturnType<typeof memoryView>>;
    onSelect: (id: string) => void;
  } = $props();
  let projects = $derived(memory.projects);
  let claims = $derived(
    memory.statements
      .filter((s) => ['active', 'conflicted'].includes(s.status))
      .slice(0, 80),
  );
  let height = $derived(
    Math.max(220, claims.length * 54 + 70, projects.length * 100 + 70),
  );
  const projectY = (id: string) =>
    50 + projects.findIndex((p) => p.id === id) * 100;
  const claimY = (id: string) => 50 + claims.findIndex((s) => s.id === id) * 54;
</script>

<div class="graph">
  <svg
    viewBox={`0 0 1100 ${height}`}
    role="img"
    aria-label="Project memory graph with assertions and source relationships"
  >
    {#each claims as claim}<line
        x1="275"
        y1={projectY(claim.projectId)}
        x2="390"
        y2={claimY(claim.id)}
        stroke="#d9e2ef"
      />{/each}
    {#each memory.relations.filter((r) => r.kind === 'conflict') as relation}{@const a =
        claims.find((s) =>
          s.history.some((v) => v.id === relation.fromVersionId),
        )}{@const b = claims.find((s) =>
        s.history.some((v) => v.id === relation.toVersionId),
      )}
      {#if a && b}<path
          d={`M 1010 ${claimY(a.id)} Q 1090 ${(claimY(a.id) + claimY(b.id)) / 2} 1010 ${claimY(b.id)}`}
          fill="none"
          stroke="#c07825"
          stroke-dasharray="5 4"
        />{/if}{/each}
    {#each projects as project}<g
        ><rect
          x="10"
          y={projectY(project.id) - 26}
          width="265"
          height="64"
          rx="10"
          fill="#e9f0fa"
        /><text x="24" y={projectY(project.id)}
          >{project.name.length > 28
            ? project.name.slice(0, 28) + '…'
            : project.name}</text
        ><text class="small" x="24" y={projectY(project.id) + 20}
          >{claims.filter((s) => s.projectId === project.id).length} visible assertions</text
        ></g
      >{/each}
    {#each claims as claim}<g
        role="button"
        tabindex="0"
        aria-label={`Inspect ${claim.current.text}`}
        onclick={() => onSelect(claim.id)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(claim.id);
          }
        }}
      >
        <rect
          x="390"
          y={claimY(claim.id) - 22}
          width="620"
          height="44"
          rx="8"
          fill={claim.status === 'conflicted' ? '#fff3d9' : '#ffffff'}
          stroke="#d3dfed"
        />
        <text x="403" y={claimY(claim.id) + 4}
          >{claim.type} · {claim.current.text.slice(0, 67)}{claim.current.text
            .length > 67
            ? '…'
            : ''}</text
        ><title>{claim.current.text}</title>
      </g>{/each}
  </svg>
</div>
{#if memory.statements.filter( (s) => ['active', 'conflicted'].includes(s.status) ).length > 80}<p
    class="muted"
  >
    The graph shows 80 assertions. Use the complete list below or filter by
    project.
  </p>{/if}

<style>
  .graph {
    max-height: 580px;
    overflow: auto;
    border: 1px solid #dfe5ec;
    border-radius: 10px;
    background: #fbfcfe;
  }
  svg {
    min-width: 800px;
    width: 100%;
    display: block;
  }
  text {
    font-size: 14px;
    fill: #24354b;
  }
  .small {
    font-size: 11px;
    fill: #66768b;
  }
  g[role='button'] {
    cursor: pointer;
  }
  g[role='button']:focus rect {
    stroke: #235dba;
    stroke-width: 2px;
  }
</style>
