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
  let layout = $derived.by(() => {
    const groups = projects.map((project) => ({
      project,
      candidates: memory.statements
        .filter(
          (s) =>
            s.projectId === project.id &&
            ['active', 'conflicted'].includes(s.status),
        )
        .sort(
          (a, b) =>
            b.current.commitVersion - a.current.commitVersion ||
            a.id.localeCompare(b.id),
        ),
      shown: [] as typeof memory.statements,
    }));
    // Share the display budget across projects and prefer their recent evidence.
    let count = 0;
    for (let rank = 0; count < 80; rank++) {
      let found = false;
      for (const group of groups) {
        if (count < 80 && group.candidates[rank]) {
          group.shown.push(group.candidates[rank]);
          count++;
          found = true;
        }
      }
      if (!found) break;
    }
    const projectPositions = new Map<string, number>();
    const claimPositions = new Map<string, number>();
    let cursor = 32;
    for (const group of groups) {
      const groupHeight = Math.max(100, group.shown.length * 54 + 20);
      projectPositions.set(group.project.id, cursor + groupHeight / 2);
      group.shown.forEach((claim, index) =>
        claimPositions.set(claim.id, cursor + 32 + index * 54),
      );
      cursor += groupHeight + 32;
    }
    return {
      claims: groups.flatMap((group) => group.shown),
      projectPositions,
      claimPositions,
      height: Math.max(220, cursor),
    };
  });
  let claims = $derived(layout.claims);
  let height = $derived(layout.height);
  const projectY = (id: string) => layout.projectPositions.get(id) ?? 0;
  const claimY = (id: string) => layout.claimPositions.get(id) ?? 0;
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
{#if memory.statements.filter( (s) => ['active', 'conflicted'].includes(s.status), ).length > 80}<p
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
