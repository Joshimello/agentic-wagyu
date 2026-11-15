<script lang="ts">
  import { afterNavigate, preloadData } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, onMount, setContext, tick, type Snippet } from 'svelte';
  import { gsap } from 'gsap';
  import '@fontsource-variable/geist';
  import '../lib/styles/workspace.css';
  import Icon from '../lib/components/Icon.svelte';
  import BrandMark from '../lib/components/BrandMark.svelte';
  import ActivityStatus from '../lib/components/ActivityStatus.svelte';
  import AskPanel from '../lib/components/AskPanel.svelte';
  import { askPanel } from '../lib/ui/ask.svelte';
  import { activityContext, createActivity } from '../lib/ui/activity.svelte';

  let {
    children,
    data,
  }: {
    children: Snippet;
    data: {
      readOnly: boolean;
      access: 'open' | 'full' | 'viewer';
      projects: { id: string; title: string }[];
    };
  } = $props();
  let content: HTMLElement;
  let scroller: HTMLDivElement;
  let entry: gsap.Context | undefined;
  let path = $derived(page.url.pathname);
  let mapActive = $derived(path.startsWith('/memory/map'));
  let memoryActive = $derived(
    path === '/' || (path.startsWith('/memory') && !mapActive),
  );
  let changesActive = $derived(path.startsWith('/changes'));
  let sourcesActive = $derived(
    ['/sources', '/staging', '/pushes'].some((p) => path.startsWith(p)),
  );
  let askScope = $derived(
    page.data?.node?.kind === 'project'
      ? { projectId: page.data.node.id as string, label: page.data.node.current.title as string }
      : { projectId: undefined, label: 'All projects' },
  );
  setContext(activityContext, createActivity());
  let nav = $state<HTMLElement>();
  let indicator = $state<HTMLSpanElement>();
  let stagingLink = $state<HTMLAnchorElement>();
  let memoryLink = $state<HTMLAnchorElement>();
  let changesLink = $state<HTMLAnchorElement>();
  let mapLink = $state<HTMLAnchorElement>();
  let indicatorReady = $state(false);
  function positionIndicator(animate = true) {
    const target = mapActive
      ? mapLink
      : changesActive
        ? changesLink
        : memoryActive
        ? memoryLink
        : sourcesActive
          ? stagingLink
          : undefined;
    if (!nav || !indicator) return;
    if (!target) {
      gsap.set(indicator, { opacity: 0 });
      return;
    }
    const bounds = target.getBoundingClientRect(),
      parent = nav.getBoundingClientRect();
    const props = {
      x: bounds.left - parent.left,
      width: bounds.width,
      height: bounds.height,
      opacity: 1,
    };
    if (
      !indicatorReady ||
      !animate ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      gsap.set(indicator, props);
    else
      gsap.to(indicator, {
        ...props,
        duration: 0.65,
        ease: 'back.out(1.35)',
        overwrite: 'auto',
      });
    indicatorReady = true;
  }
  $effect(() => {
    memoryActive;
    sourcesActive;
    changesActive;
    mapActive;
    if (typeof window !== 'undefined')
      void tick().then(() => positionIndicator());
  });
  onMount(() => {
    // Load the Projects page and its pictures ahead of time, so opening it is instant.
    const warm = setTimeout(async () => {
      try {
        const result = await preloadData('/');
        if (result.type !== 'loaded') return;
        for (const p of (result.data as { projects?: { picture?: string | null }[] })
          .projects ?? [])
          if (p.picture) new Image().src = `/api/assets/${p.picture}`;
      } catch {}
    }, 1200);
    const observer = new ResizeObserver(() => positionIndicator(false));
    if (nav) observer.observe(nav);
    return () => {
      clearTimeout(warm);
      observer.disconnect();
      if (indicator) gsap.killTweensOf(indicator);
    };
  });

  afterNavigate(async (navigation) => {
    await tick();
    if (
      scroller &&
      navigation.from?.url.pathname !== navigation.to?.url.pathname
    )
      scroller.scrollTop = 0;
    entry?.revert();
    if (
      !content ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    entry = gsap.context(() => {
      const sections = Array.from(content.children).filter(
        (element) =>
          element instanceof HTMLElement &&
          !['STYLE', 'SCRIPT'].includes(element.tagName),
      );
      gsap.fromTo(
        sections.slice(0, 8),
        { opacity: 1, y: 6 },
        {
          opacity: 1,
          y: 0,
          duration: 0.24,
          stagger: 0.012,
          ease: 'power3.out',
          clearProps: 'opacity,transform',
        },
      );
    }, content);
  });

  onDestroy(() => entry?.revert());
</script>

<svelte:head><title>Chronicler | Research workspace</title></svelte:head>
<a class="skip-link" href="#workspace-content">Skip to content</a>
<div class="shell">
  <div class="shell-main">
  <header class="workspace-header">
    <a class="brand" href="/" aria-label="Chronicler projects">
      <span class="brand-mark"><BrandMark size={21} /></span>
      <span>Chronicler<small>Research workspace</small></span>
    </a>
    <nav
      class="workspace-nav"
      class:indicator-ready={indicatorReady}
      aria-label="Workspace"
      bind:this={nav}
    >
      <span class="nav-indicator" aria-hidden="true" bind:this={indicator}
      ></span>
      <a
        bind:this={memoryLink}
        href="/"
        class:current={memoryActive}
        aria-current={memoryActive ? 'page' : undefined}
      >
        <Icon name="grid" size={17} /><span>Projects</span>
      </a>
      <a
        bind:this={stagingLink}
        href="/sources"
        class:current={sourcesActive}
        aria-current={sourcesActive ? 'page' : undefined}
      >
        <Icon name="folder" size={17} /><span>Sources</span>
      </a>
      <a
        bind:this={changesLink}
        href="/changes"
        class:current={changesActive}
        aria-current={changesActive ? 'page' : undefined}
        ><Icon name="refresh" size={17} /><span>Changes</span></a
      >
      <a
        bind:this={mapLink}
        href="/memory/map"
        class:current={mapActive}
        aria-current={mapActive ? 'page' : undefined}
        ><Icon name="history" size={17} /><span>Memory</span></a
      >
    </nav>
    <ActivityStatus />
    <button
      class="ask-toggle"
      class:open={askPanel.open}
      aria-expanded={askPanel.open}
      aria-controls="ask-panel"
      onclick={() => (askPanel.open = !askPanel.open)}
      ><Icon name="help" size={17} /><span>Ask</span></button
    >
  </header>
  <div class="workspace-scroll" bind:this={scroller}>
    <div class="workspace-body">
      <main id="workspace-content" bind:this={content} tabindex="-1">
        {#if data.readOnly}<p role="status">
            Restored workspace - inspection only. Uploads, pushes and new
            questions are disabled until this workspace is resumed.
          </p>{/if}
        {#if data.access === 'viewer'}<p role="status">
            View-only account. You can inspect sources, memory, answers and
            reviews; uploads, pushes, questions and approvals are disabled.
          </p>{/if}
        {@render children()}
      </main>
      <footer class="workspace-footer">
        <span>Chronicler</span>
        <span class="footer-links">
          <a href="/operations">Operations</a>
          {#if data.access !== 'open'}<form method="POST" action="/logout">
              <button class="sign-out" type="submit">Sign out</button>
            </form>{/if}
        </span>
      </footer>
    </div>
  </div>
  </div>
  <AskPanel scope={askScope} projects={data.projects} />
</div>

<style>
  .shell {
    height: 100dvh;
    display: flex;
    overflow: hidden;
    position: relative;
  }
  .shell-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    /* The header adapts to the room left beside the Ask panel, not the window. */
    container: workspace / inline-size;
  }
  .workspace-body {
    max-width: 1540px;
    margin: auto;
    padding: 0 clamp(1rem, 3.5vw, 3.5rem);
  }
  .workspace-scroll {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
  }
  .ask-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    border-radius: 8px;
    flex: none;
  }
  .ask-toggle.open {
    background: var(--blue-soft);
    color: var(--blue-ink);
  }
  .workspace-header {
    flex-shrink: 0;
    width: 100%;
    max-width: 1540px;
    margin: 0 auto;
    padding: 0 clamp(1rem, 3.5vw, 3.5rem);
    min-height: 6rem;
    display: flex;
    align-items: center;
    gap: 2rem;
    border-bottom: 1px solid var(--border);
    position: relative;
    z-index: 60;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--ink);
    letter-spacing: -0.035em;
  }
  .brand:hover {
    text-decoration: none;
  }
  .brand small {
    display: block;
    color: var(--muted);
    font-size: 0.68rem;
    font-weight: 400;
    letter-spacing: 0.015em;
    margin-top: -0.15rem;
  }
  .brand-mark {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .workspace-nav {
    position: relative;
    display: inline-flex;
    align-items: center;
    padding: 4px;
    gap: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-left: auto;
    background: var(--canvas);
  }
  .workspace-nav a {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.45rem 1rem;
    border-radius: 5px;
    color: var(--muted);
    font-size: 0.85rem;
    transition:
      background 180ms,
      color 180ms,
      transform 120ms;
  }
  .workspace-nav a:hover {
    color: var(--ink);
    text-decoration: none;
    background: var(--surface);
  }
  .workspace-nav a.current {
    background: var(--accent);
    color: white;
  }
  .workspace-nav.indicator-ready a.current {
    background: transparent;
  }
  .nav-indicator {
    position: absolute;
    top: 4px;
    left: 0;
    border-radius: 5px;
    background: var(--accent);
    opacity: 0;
    pointer-events: none;
  }
  .workspace-nav a:active {
    transform: scale(0.97);
  }
  main {
    min-height: calc(100svh - 11.33rem);
    padding: 2.4rem 0 4rem;
    outline: none;
  }
  .workspace-footer {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    color: var(--muted);
    font-size: 0.73rem;
    padding: 1.5rem 0;
    border-top: 1px solid var(--border);
  }
  .footer-links {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }
  .sign-out {
    background: none;
    color: inherit;
    border: 0;
    padding: 0;
    font-size: inherit;
    font-weight: inherit;
  }
  .sign-out:hover {
    background: none;
    color: var(--ink);
    text-decoration: underline;
  }
  .skip-link {
    position: fixed;
    left: 1rem;
    top: -5rem;
    z-index: 100;
    background: var(--ink);
    color: white;
    padding: 0.7rem 1rem;
    border-radius: 6px;
  }
  .skip-link:focus {
    top: 1rem;
  }
  @media (max-width: 800px) {
    .workspace-header {
      gap: 1rem;
      min-height: 5.2rem;
    }
    main {
      padding: 1.5rem 0 3rem;
    }
  }
  @media (max-width: 600px) {
    .workspace-header {
      flex-wrap: wrap;
      padding-block: 0.85rem;
      gap: 0.65rem;
    }
    .brand {
      margin-right: auto;
    }
    .workspace-nav {
      order: 3;
      margin-left: 0;
    }
    .workspace-header :global(.activity-status) {
      margin-left: auto;
    }
  }
  @media (max-width: 420px) {
    .workspace-header {
      flex-wrap: wrap;
      gap: 0.55rem;
      padding-block: 0.8rem;
    }
    .brand small {
      display: none;
    }
    .brand {
      font-size: 1.05rem;
      gap: 0.45rem;
    }
    .brand-mark {
      width: 2rem;
      height: 2rem;
    }
    .workspace-nav a {
      padding: 0.45rem 0.55rem;
    }
    .workspace-nav a :global(.ui-icon) {
      display: none;
    }
    .ask-toggle span {
      display: none;
    }
    .workspace-footer span:first-child {
      display: none;
    }
  }
  /* Kept last so these win over the base header rules above. */
  @container workspace (max-width: 1000px) {
    .workspace-header {
      gap: 0.8rem;
    }
    .brand small {
      display: none;
    }
    .workspace-nav a {
      padding: 0.45rem 0.7rem;
    }
    .workspace-nav a :global(.ui-icon) {
      display: none;
    }
  }
  @container workspace (max-width: 720px) {
    .workspace-header {
      flex-wrap: wrap;
      padding-block: 0.8rem;
      gap: 0.6rem;
    }
    .brand {
      margin-right: auto;
    }
    .workspace-nav {
      order: 3;
      margin-left: 0;
      max-width: 100%;
      overflow-x: auto;
    }
    .workspace-header :global(.activity-status) {
      margin-left: auto;
    }
  }
</style>
