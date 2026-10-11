<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, tick, type Snippet } from 'svelte';
  import { gsap } from 'gsap';
  import '@fontsource-variable/outfit';
  import '@fontsource-variable/newsreader';
  import '../lib/styles/workspace.css';
  import Icon from '../lib/components/Icon.svelte';

  let { children, data }: { children: Snippet; data: { readOnly: boolean } } =
    $props();
  let content: HTMLElement;
  let entry: gsap.Context | undefined;
  let memoryActive = $derived(page.url.pathname.startsWith('/memory'));
  let askActive = $derived(page.url.pathname.startsWith('/ask'));

  afterNavigate(async () => {
    await tick();
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
          duration: 0.38,
          stagger: 0.035,
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
      <span class="brand-mark"><Icon name="books" size={23} /></span>
      <span>Chronicler<small>Research workspace</small></span>
    </a>
    <nav class="workspace-nav" aria-label="Workspace">
      <a
        href="/"
        class:current={!memoryActive && !askActive}
        aria-current={!memoryActive && !askActive ? 'page' : undefined}
      >
        <Icon name="folder" size={17} /><span>Staging</span>
      </a>
      <a
        href="/memory"
        class:current={memoryActive}
        aria-current={memoryActive ? 'page' : undefined}
      >
        <Icon name="grid" size={17} /><span>Memory</span>
      </a>
      <a
        href="/ask"
        class:current={askActive}
        aria-current={askActive ? 'page' : undefined}
      >
        <Icon name="search" size={17} /><span>Ask</span>
      </a>
    </nav>
    <span class="workspace-location"
      ><span class="status-dot"></span>Local workspace</span
    >
  </header>
  <main id="workspace-content" bind:this={content} tabindex="-1">
    {#if data.readOnly}<p role="status">
        Restored workspace · Inspection only. Uploads, pushes and new questions
        are disabled until this workspace is resumed.
      </p>{/if}
    {@render children()}
  </main>
  <footer class="workspace-footer">
    <span>Chronicler</span>
    <a href="/operations">Operations</a>
  </footer>
</div>

<style>
  .shell {
    max-width: 1540px;
    margin: auto;
    padding: 0 clamp(1rem, 3.5vw, 3.5rem);
  }
  .workspace-header {
    min-height: 90px;
    display: flex;
    align-items: center;
    gap: 2rem;
    border-bottom: 1px solid var(--border);
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
    background: var(--ink);
    color: white;
  }
  .workspace-nav a:active {
    transform: scale(0.97);
  }
  .workspace-location {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    background: #69816b;
    border-radius: 50%;
  }
  main {
    min-height: calc(100svh - 170px);
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
      min-height: 78px;
    }
    .workspace-location {
      display: none;
    }
    main {
      padding: 1.5rem 0 3rem;
    }
  }
  @media (max-width: 420px) {
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
      padding: 0.45rem 0.65rem;
    }
    .workspace-nav a :global(.ui-icon) {
      display: none;
    }
    .workspace-footer span:first-child {
      display: none;
    }
  }
</style>
