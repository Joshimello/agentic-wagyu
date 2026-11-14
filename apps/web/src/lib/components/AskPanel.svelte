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
    input: { question: string };
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

  let { scope }: { scope: { projectId?: string; label: string } } = $props();
  let messages = $state<Message[]>([]),
    draft = $state(''),
    thread = $state<HTMLDivElement>(),
    input = $state<HTMLInputElement>();
  const storeKey = 'chronicler.ask.runs';
  const pending = (m: Message) =>
    !m.error && (!m.run || ['queued', 'processing'].includes(m.run.state));
  const suggestions = $derived(
    scope.projectId
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
  async function send(question: string, projectId = scope.projectId) {
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
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (!askPanel.queue.length) return;
    const waiting = askPanel.queue.splice(0);
    for (const item of waiting) void send(item.question, item.projectId);
  });
  $effect(() => {
    if (askPanel.open) void tick().then(() => input?.focus({ preventScroll: true }));
  });
</script>

{#if askPanel.open}
  <aside class="ask-panel" id="ask-panel" aria-label="Ask">
    <header>
      <span class="scope"
        ><Icon name="folder" size={15} /><strong>{scope.label}</strong></span
      >
      <span class="head-actions">
        <a href="/ask">History</a>
        <button
          class="secondary icon-button"
          aria-label="Close Ask"
          onclick={() => (askPanel.open = false)}
          ><Icon name="close" size={16} /></button
        >
      </span>
    </header>
    <div class="thread" bind:this={thread} aria-live="polite">
      {#if !messages.length}
        <div class="empty">
          <strong>Ask about your meetings</strong>
          <p>Answers link to the exact moment in the recording or slide.</p>
        </div>
      {/if}
      {#each messages as message (message.key)}
        <p class="mine">
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
            <a class="full" href={`/ask/${message.run.id}`}>Full answer</a>
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
          placeholder={scope.projectId
            ? 'Ask about this project'
            : 'Ask about your meetings'}
          maxlength="4000"
          autocomplete="off"
        />
        <button class="send" aria-label="Send" disabled={!draft.trim()}
          ><Icon name="arrow-up" size={17} /></button
        >
      </form>
    </div>
  </aside>
{/if}

<style>
  .ask-panel {
    flex: none;
    width: min(26rem, 38vw);
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--border);
    font-size: 0.85rem;
    animation: ask-in 260ms var(--ease-out);
  }
  @keyframes ask-in {
    from {
      transform: translateX(1rem);
      opacity: 0.4;
    }
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.6rem 0.6rem 0.6rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .scope {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    color: var(--muted);
  }
  .scope strong {
    color: var(--ink);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    flex: none;
  }
  .head-actions a {
    color: var(--muted);
    font-size: 0.78rem;
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
    display: grid;
    place-items: center;
    border-radius: 0.6rem;
    flex: none;
  }
  @media (max-width: 900px) {
    .ask-panel {
      position: absolute;
      inset: 0;
      width: auto;
      z-index: 50;
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
