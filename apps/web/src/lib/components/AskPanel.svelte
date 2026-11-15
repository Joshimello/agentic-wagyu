<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { askPanel, nextMeetingQuestion } from '../ui/ask.svelte';

  type Citation = {
    id: string;
    revisionId: string;
    filename: string;
    kind: 'text' | 'image';
    quote?: string;
    url: string;
    locator: { kind: string; startMs?: number; slide?: number; page?: number };
  };
  type Run = {
    id: string;
    state: string;
    progress?: string | null;
    error?: string | null;
    input: { question: string; projectId?: string };
    answer?: {
      status: string;
      claims: {
        text: string;
        basis: 'source' | 'inference' | 'conflict' | 'reviewed';
        citations: string[];
        reviewRefs?: string[];
      }[];
      citations: Citation[];
      limitations: string[];
      reviewReferences?: { id: string; url: string; reviewVersion: number }[];
    } | null;
  };
  type Message = { key: string; question: string; run?: Run; error?: string };
  type Past = {
    id: string;
    question: string;
    state: string;
    scope: { projectId?: string };
    createdAt: string;
  };

  let {
    scope,
    projects = [],
  }: {
    scope: { projectId?: string; label: string };
    projects?: { id: string; title: string }[];
  } = $props();
  // The panel follows the project page you are on, until you pick another.
  let selected = $state('');
  $effect(() => {
    selected = scope.projectId ?? '';
  });
  $effect(() => {
    if (!askPanel.focus) return;
    selected = askPanel.focus;
    askPanel.focus = undefined;
    view = 'chat';
  });
  const title = (id?: string) =>
    (id && projects.find((p) => p.id === id)?.title) || 'All projects';
  let picking = $state(false),
    picker = $state<HTMLDivElement>();
  let view = $state<'chat' | 'history'>('chat'),
    past = $state<Past[] | null>(null),
    pastError = $state('');
  const minWidth = 320,
    defaultWidth = 416,
    widthKey = 'chronicler.ask.width';
  let width = $state(defaultWidth),
    dragging = $state(false);
  const clampWidth = (value: number) =>
    Math.round(
      Math.max(minWidth, Math.min(value, Math.max(minWidth, innerWidth * 0.6))),
    );
  function saveWidth() {
    try {
      localStorage.setItem(widthKey, String(width));
    } catch {}
  }
  function drag(event: PointerEvent) {
    if (event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    dragging = true;
    const move = (e: PointerEvent) =>
      (width = clampWidth(innerWidth - e.clientX));
    const stop = () => {
      dragging = false;
      handle.removeEventListener('pointermove', move);
      saveWidth();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop, { once: true });
    handle.addEventListener('pointercancel', stop, { once: true });
  }
  function nudge(event: KeyboardEvent) {
    const step =
      event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0;
    if (!step) return;
    event.preventDefault();
    width = clampWidth(width + step);
    saveWidth();
  }
  async function openHistory() {
    view = 'history';
    pastError = '';
    try {
      const response = await fetch('/api/research');
      if (!response.ok) throw new Error();
      past = await response.json();
    } catch {
      pastError = 'Could not load earlier questions.';
    }
  }
  async function openPast(item: Past) {
    view = 'chat';
    if (!messages.some((m) => m.run?.id === item.id)) {
      messages.push({ key: item.id, question: item.question });
      const message = messages[messages.length - 1];
      try {
        const response = await fetch(`/api/research/${item.id}`);
        if (!response.ok) throw new Error();
        message.run = await response.json();
        remember();
      } catch {
        message.error = 'Could not open this answer.';
      }
    }
    await tick();
    thread
      ?.querySelector(`[data-run="${item.id}"]`)
      ?.scrollIntoView({ block: 'start' });
  }
  function newChat() {
    messages = [];
    view = 'chat';
    remember();
    input?.focus();
  }
  const when = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  let messages = $state<Message[]>([]),
    draft = $state(''),
    thread = $state<HTMLDivElement>(),
    input = $state<HTMLInputElement>();
  const storeKey = 'chronicler.ask.runs';
  const pending = (m: Message) =>
    !m.error && (!m.run || ['queued', 'processing'].includes(m.run.state));
  const suggestions = $derived(
    selected
      ? [
          { label: "What's still open?", text: 'What is still open or unfinished in this project?' },
          { label: 'Prepare next meeting', text: nextMeetingQuestion },
        ]
      : [
          { label: 'What changed recently?', text: 'What changed in the most recent meetings?' },
          { label: "What's still open?", text: 'Which commitments are still open, and who owns them?' },
        ],
  );

  function remember() {
    try {
      sessionStorage.setItem(
        storeKey,
        JSON.stringify(messages.flatMap((m) => (m.run ? [m.run.id] : [])).slice(-8)),
      );
    } catch {}
  }
  async function scrollDown() {
    await tick();
    if (thread) thread.scrollTop = thread.scrollHeight;
  }
  async function send(
    question: string,
    projectId: string | undefined = selected,
  ) {
    const text = question.trim();
    if (!text) return;
    const key = crypto.randomUUID();
    messages.push({ key, question: text });
    const message = messages[messages.length - 1];
    void scrollDown();
    try {
      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: text,
          idempotencyKey: key,
          ...(projectId ? { projectId } : {}),
        }),
      });
      const run = await response.json();
      if (!response.ok) throw new Error(run.error);
      message.run = run;
      remember();
    } catch (e) {
      message.error = e instanceof Error ? e.message : 'Could not ask';
    }
  }
  async function refresh(message: Message) {
    if (!message.run) return;
    try {
      const response = await fetch(`/api/research/${message.run.id}`);
      if (!response.ok) return;
      const before = message.run.state;
      message.run = await response.json();
      if (before !== message.run!.state) void scrollDown();
    } catch {}
  }
  async function retry(message: Message) {
    if (!message.run) return;
    await fetch(`/api/research/${message.run.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'retry' }),
    }).catch(() => {});
    await refresh(message);
  }
  const place = (c: Citation) =>
    c.locator.kind === 'media' && c.locator.startMs !== undefined
      ? `${Math.floor(c.locator.startMs / 60000)}:${String(Math.floor(c.locator.startMs / 1000) % 60).padStart(2, '0')}`
      : c.locator.kind === 'slide'
        ? `Slide ${c.locator.slide}`
        : c.locator.kind === 'page'
          ? `Page ${c.locator.page}`
          : 'Text';
  // Recordings open at the cited moment; slides and pages open as evidence.
  const target = (c: Citation) =>
    c.locator.kind === 'media' && c.locator.startMs !== undefined
      ? `/meeting/${c.revisionId}?t=${Math.floor(c.locator.startMs)}`
      : c.url;
  const short = (name: string) => {
    const base = name.replace(/\.[a-z0-9]+$/i, '');
    return base.length > 22 ? `${base.slice(0, 21)}…` : base;
  };

  onMount(() => {
    try {
      const saved = Number(localStorage.getItem(widthKey));
      if (saved) width = clampWidth(saved);
    } catch {}
    const outside = (event: PointerEvent) => {
      if (picking && picker && !picker.contains(event.target as Node))
        picking = false;
    };
    document.addEventListener('pointerdown', outside);
    let ids: string[] = [];
    try {
      ids = JSON.parse(sessionStorage.getItem(storeKey) ?? '[]');
    } catch {}
    void Promise.all(
      ids.map((id) =>
        fetch(`/api/research/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((runs) => {
      const restored = runs
        .filter((run): run is Run => !!run?.id)
        .map((run) => ({ key: run.id, question: run.input.question, run }));
      if (restored.length) {
        messages.unshift(...restored);
        void scrollDown();
      }
    });
    const timer = setInterval(() => {
      for (const message of messages)
        if (message.run && pending(message)) void refresh(message);
    }, 1500);
    return () => {
      clearInterval(timer);
      document.removeEventListener('pointerdown', outside);
    };
  });
  $effect(() => {
    if (!askPanel.queue.length) return;
    view = 'chat';
    const waiting = askPanel.queue.splice(0);
    for (const item of waiting) void send(item.question, item.projectId);
  });
  $effect(() => {
    if (askPanel.open) void tick().then(() => input?.focus({ preventScroll: true }));
  });
</script>

{#if askPanel.open}
  <aside
    class="ask-panel"
    class:dragging
    id="ask-panel"
    aria-label="Ask"
    style:width={`${width}px`}
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Ask panel"
      aria-valuemin={minWidth}
      aria-valuenow={width}
      tabindex="0"
      onpointerdown={drag}
      onkeydown={nudge}
      ondblclick={() => {
        width = defaultWidth;
        saveWidth();
      }}
    ></div>
    <header>
      {#if view === 'history'}
        <button class="ghost back" onclick={() => (view = 'chat')}
          ><Icon name="arrow-left" size={15} />Back to chat</button
        >
      {:else}
        <div class="picker" bind:this={picker}>
          <button
            class="ghost scope"
            aria-haspopup="listbox"
            aria-expanded={picking}
            onclick={() => (picking = !picking)}
            onkeydown={(e) => e.key === 'Escape' && (picking = false)}
            ><Icon name="folder" size={15} /><strong>{title(selected)}</strong
            ><Icon name="chevron-down" size={13} /></button
          >
          {#if picking}
            <ul class="menu" role="listbox" aria-label="Ask about">
              {#each [{ id: '', title: 'All projects' }, ...projects] as p (p.id)}
                <li role="option" aria-selected={selected === p.id}>
                  <button
                    class="ghost"
                    onclick={() => {
                      selected = p.id;
                      picking = false;
                      input?.focus();
                    }}
                    ><span>{p.title}</span>{#if selected === p.id}<Icon
                        name="check"
                        size={14}
                      />{/if}</button
                  >
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      <span class="head-actions">
        {#if view === 'chat'}
          {#if messages.length}<button
              class="ghost icon"
              aria-label="New chat"
              title="New chat"
              onclick={newChat}><Icon name="plus" size={16} /></button
            >{/if}
          <button
            class="ghost icon"
            aria-label="History"
            title="History"
            onclick={openHistory}><Icon name="history" size={16} /></button
          >
        {/if}
        <button
          class="ghost icon"
          aria-label="Close Ask"
          title="Close"
          onclick={() => (askPanel.open = false)}
          ><Icon name="close" size={16} /></button
        >
      </span>
    </header>
    {#if view === 'history'}
      <div class="thread history">
        <h2>Earlier questions</h2>
        {#if pastError}<p class="error" role="alert">{pastError}</p>
        {:else if !past}<p class="working">
            <span class="pulse" aria-hidden="true"></span>Loading…
          </p>
        {:else if !past.length}<p class="quiet">
            Questions you ask will be kept here.
          </p>
        {:else}
          {#each past as item (item.id)}
            <button class="ghost past" onclick={() => openPast(item)}>
              <span class="past-q"
                >{item.question === nextMeetingQuestion
                  ? 'Prepare next meeting'
                  : item.question}</span
              >
              <span class="past-meta"
                >{title(item.scope?.projectId)} · {when(
                  item.createdAt,
                )}{item.state === 'completed' ? '' : ` · ${item.state}`}</span
              >
            </button>
          {/each}
        {/if}
      </div>
    {:else}
    <div class="thread" bind:this={thread} aria-live="polite">
      {#if !messages.length}
        <div class="empty">
          <strong>Ask about {selected ? title(selected) : 'your meetings'}</strong>
          <p>Answers link to the exact moment in the recording or slide.</p>
        </div>
      {/if}
      {#each messages as message (message.key)}
        <p class="mine" data-run={message.run?.id}>
          {message.question === nextMeetingQuestion
            ? 'Prepare next meeting'
            : message.question}
        </p>
        <div class="reply">
          {#if message.error}
            <p class="error" role="alert">{message.error}</p>
          {:else if pending(message)}
            <p class="working">
              <span class="pulse" aria-hidden="true"></span>{message.run
                ?.progress ?? 'Starting…'}
            </p>
          {:else if message.run?.answer}
            {@const answer = message.run.answer}
            {#each answer.claims as claim}
              <div class="claim">
                <p>
                  {#if claim.basis === 'inference'}<span class="basis"
                      >Inference</span
                    >{:else if claim.basis === 'conflict'}<span class="basis"
                      >Conflict</span
                    >{/if}{claim.text}
                </p>
                {#if claim.citations.length || claim.reviewRefs?.length}
                  <div class="cites">
                    {#each claim.reviewRefs ?? [] as ref}{@const review =
                        answer.reviewReferences?.find((r) => r.id === ref)}
                      {#if review}<a class="cite reviewed" href={review.url}
                          ><Icon name="check" size={12} />Approved</a
                        >{/if}{/each}
                    {#each claim.citations as ref}{@const c =
                        answer.citations.find((c) => c.id === ref)}
                      {#if c}<a
                          class="cite"
                          href={target(c)}
                          title={c.quote ?? 'Open the source'}
                          >{#if c.locator.kind === 'media'}<Icon
                              name="play"
                              size={11}
                            />{/if}{short(c.filename)} · {place(c)}</a
                        >{/if}{/each}
                  </div>
                {/if}
              </div>
            {/each}
            {#if answer.limitations.length}
              <details>
                <summary
                  >{answer.limitations.length} thing{answer.limitations
                    .length > 1
                    ? 's'
                    : ''} not established</summary
                >
                <ul>
                  {#each answer.limitations as limitation}<li>
                      {limitation}
                    </li>{/each}
                </ul>
              </details>
            {/if}
            <a class="full" href={`/ask/${message.run.id}`}>Evidence details</a>
          {:else}
            <p class="error" role="alert">
              {message.run?.error ?? 'This question did not finish.'}
            </p>
            <button class="secondary" onclick={() => retry(message)}
              >Try again</button
            >
          {/if}
        </div>
      {/each}
    </div>
    <div class="composer">
      {#if messages.length < 2}
        <div class="suggestions">
          {#each suggestions as s}<button
              class="secondary"
              onclick={() => send(s.text)}>{s.label}</button
            >{/each}
        </div>
      {/if}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          const text = draft;
          draft = '';
          void send(text);
        }}
      >
        <input
          bind:this={input}
          bind:value={draft}
          aria-label="Question"
          placeholder={selected
            ? 'Ask about this project'
            : 'Ask about all projects'}
          maxlength="4000"
          autocomplete="off"
        />
        <button class="send" aria-label="Send" disabled={!draft.trim()}
          ><Icon name="arrow-up" size={17} /></button
        >
      </form>
    </div>
    {/if}
  </aside>
{/if}

<style>
  .ask-panel {
    flex: none;
    position: relative;
    /* Never wider than the saved size allows on a smaller window. */
    max-width: max(320px, 60vw);
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--border);
    font-size: 0.85rem;
    animation: ask-in 260ms var(--ease-out);
  }
  .ask-panel.dragging {
    user-select: none;
  }
  @keyframes ask-in {
    from {
      transform: translateX(1rem);
      opacity: 0.4;
    }
  }
  .resizer {
    position: absolute;
    left: -5px;
    top: 0;
    bottom: 0;
    width: 10px;
    cursor: col-resize;
    z-index: 70;
    touch-action: none;
  }
  .resizer::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 150ms;
  }
  .resizer:hover::after,
  .resizer:focus-visible::after,
  .dragging .resizer::after {
    opacity: 1;
  }
  .resizer:focus-visible {
    outline: none;
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    min-height: 3.4rem;
    padding: 0.5rem 0.6rem 0.5rem 0.7rem;
    border-bottom: 1px solid var(--border);
  }
  .ghost {
    background: none;
    border: 0;
    color: var(--ink);
    font-weight: 400;
    font-size: inherit;
    border-radius: 6px;
    padding: 0.4rem 0.5rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    transition: background 150ms;
  }
  .ghost:hover {
    background: var(--canvas);
    color: var(--ink);
  }
  .ghost.icon {
    color: var(--muted);
    padding: 0.45rem;
  }
  .picker {
    position: relative;
    min-width: 0;
  }
  .scope {
    max-width: 100%;
    color: var(--muted);
  }
  .scope strong {
    color: var(--ink);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 10;
    width: max-content;
    min-width: 14rem;
    max-width: min(22rem, 80vw);
    max-height: 60vh;
    overflow-y: auto;
    margin: 0;
    padding: 0.3rem;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.1);
  }
  .menu button {
    width: 100%;
    justify-content: space-between;
    text-align: left;
    padding: 0.5rem 0.6rem;
  }
  .menu li[aria-selected='true'] button {
    color: var(--blue-ink);
    font-weight: 500;
  }
  .head-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
    flex: none;
  }
  .history {
    gap: 0.2rem;
  }
  .history h2 {
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--muted);
    margin: 0 0 0.4rem 0.5rem;
  }
  .past {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    text-align: left;
    padding: 0.55rem 0.5rem;
    width: 100%;
  }
  .past-q {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
  }
  .past-meta,
  .quiet {
    color: var(--muted);
    font-size: 0.74rem;
  }
  .quiet {
    margin-left: 0.5rem;
  }
  .thread {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .empty {
    margin: auto 0;
    text-align: center;
    color: var(--muted);
  }
  .empty strong {
    color: var(--ink);
    font-weight: 600;
    font-size: 0.95rem;
  }
  p {
    margin: 0;
    user-select: text;
  }
  .mine {
    align-self: flex-end;
    max-width: 85%;
    background: var(--ink);
    color: white;
    padding: 0.5rem 0.8rem;
    border-radius: 0.9rem 0.9rem 0.25rem 0.9rem;
  }
  .reply {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    align-items: flex-start;
  }
  .claim {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 100%;
  }
  .basis {
    font-size: 0.7rem;
    background: var(--yellow-soft);
    color: var(--yellow-ink);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
    margin-right: 0.4rem;
  }
  .cites {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .cite {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.74rem;
    font-weight: 400;
    line-height: 1.5;
    padding: 0.1rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--canvas);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    transition:
      border-color 150ms,
      color 150ms,
      transform 150ms var(--ease-out);
  }
  .cite:hover {
    border-color: var(--accent);
    color: var(--blue-ink);
    background: var(--canvas);
    text-decoration: none;
    transform: translateY(-1px);
  }
  .cite.reviewed {
    background: var(--blue-soft);
    color: var(--blue-ink);
    border-color: transparent;
  }
  .full {
    font-size: 0.74rem;
    color: var(--muted);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  details {
    color: var(--muted);
    font-size: 0.78rem;
  }
  summary {
    cursor: pointer;
  }
  ul {
    margin: 0.4rem 0 0;
    padding-left: 1.1rem;
  }
  .working {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted);
  }
  .pulse {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  .composer {
    flex: none;
    padding: 0.4rem 0.9rem 0.9rem;
  }
  .suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }
  .suggestions button {
    font-size: 0.78rem;
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
  }
  form {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    padding: 0.3rem 0.3rem 0.3rem 0.8rem;
    background: var(--surface);
    transition: border-color 150ms;
  }
  form:focus-within {
    border-color: var(--accent);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    padding: 0.4rem 0;
    font-size: 0.88rem;
    caret-color: var(--accent);
  }
  .send {
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    /* The shared button rule packs content to the left; centre the arrow. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.6rem;
    flex: none;
  }
  @media (max-width: 900px) {
    .resizer {
      display: none;
    }
    .ask-panel {
      position: absolute;
      inset: 0;
      width: auto !important;
      max-width: none;
      /* Full-screen on a small window: sit above the page header. */
      z-index: 80;
      border-left: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ask-panel,
    .pulse {
      animation: none;
    }
  }
</style>
