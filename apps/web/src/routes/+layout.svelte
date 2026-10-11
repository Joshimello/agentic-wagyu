<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, onMount, setContext, tick, type Snippet } from 'svelte';
  import { gsap } from 'gsap';
  import '@fontsource-variable/geist';
  import '../lib/styles/workspace.css';
  import Icon from '../lib/components/Icon.svelte';
  import BrandMark from '../lib/components/BrandMark.svelte';
  import ActivityStatus from '../lib/components/ActivityStatus.svelte';
  import { activityContext, createActivity } from '../lib/ui/activity.svelte';

  let { children }: { children: Snippet } = $props();
  let content: HTMLElement;
  let scroller: HTMLDivElement;
  let entry: gsap.Context | undefined;
  let memoryActive = $derived(page.url.pathname.startsWith('/memory'));
  setContext(activityContext, createActivity());
  let nav = $state<HTMLElement>();
  let indicator = $state<HTMLSpanElement>();
  let stagingLink = $state<HTMLAnchorElement>();
  let memoryLink = $state<HTMLAnchorElement>();
  let indicatorReady = $state(false);
  function positionIndicator(animate = true) {
    const target = memoryActive ? memoryLink : stagingLink;
    if (!nav || !indicator || !target) return;
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
    if (typeof window !== 'undefined')
      void tick().then(() => positionIndicator());
  });
  onMount(() => {
    const observer = new ResizeObserver(() => positionIndicator(false));
    if (nav) observer.observe(nav);
    return () => {
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
  <header class="workspace-header">
    <a class="brand" href="/" aria-label="Chronicler staging">
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
        bind:this={stagingLink}
        href="/"
        class:current={!memoryActive}
        aria-current={!memoryActive ? 'page' : undefined}
      >
        <Icon name="folder" size={17} /><span>Staging</span>
      </a>
      <a
        bind:this={memoryLink}
        href="/memory"
        class:current={memoryActive}
        aria-current={memoryActive ? 'page' : undefined}
      >
        <Icon name="grid" size={17} /><span>Memory</span>
      </a>
    </nav>
    <ActivityStatus />
  </header>
  <div class="workspace-scroll" bind:this={scroller}>
    <div class="workspace-body">
      <main id="workspace-content" bind:this={content} tabindex="-1">
        {@render children()}
      </main>
      <footer class="workspace-footer">
        <span>Chronicler</span>
        <span>Review sources. Build research memory.</span>
      </footer>
    </div>
  </div>
</div>

<style>
  .shell {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .workspace-body {
    max-width: 1540px;
    margin: auto;
    padding: 0 clamp(1rem, 3.5vw, 3.5rem);
  }
  .workspace-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
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
    .workspace-footer span:first-child {
      display: none;
    }
  }
</style>
