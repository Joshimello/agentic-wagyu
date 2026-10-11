<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { Stage, Primitive } from '../server/contracts';
  import Icon from './Icon.svelte';
  import Disclosure from './Disclosure.svelte';
  import Tooltip from './Tooltip.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import type { TranslationStatus } from '../server/contracts/translations';

  type Text = Extract<Primitive, { kind: 'text' }>;
  type Translation = TranslationStatus;
  let {
    stage,
    uploadId,
    isVideo = true,
    canEdit = false,
    onseek,
    onupdated,
  }: {
    stage: Stage;
    uploadId: string;
    isVideo?: boolean;
    canEdit?: boolean;
    onseek: (ms: number) => void;
    onupdated: () => Promise<void>;
  } = $props();
  let texts = $derived(
    stage.primitives.filter((p): p is Text => p.kind === 'text'),
  );
  // Documents also expose canonical text anchors in DocumentViewer. The
  // reading-copy dialog must not duplicate those IDs or steal source focus.
  const rowId = (id: string) =>
    `${stage.document ? 'reader-text' : 'text'}-${id}`;
  let dialog = $state<HTMLDialogElement>();
  let opened = $state(false);
  let editing = $state(false);
  let saving = $state(false);
  let search = $state('');
  let limit = $state(60);
  let highlight = $state('');
  let language = $state<'original' | 'en' | 'zh-TW'>('original');
  let translation = $state<Translation | null>(null);
  let loading = $state(false);
  let canceling = $state(false);
  let error = $state('');
  let notice = $state('');
  let draftLabel = $state('');
  let draftTime = $state('');
  let baseTime = $state('');
  let baseRevision = $state('');
  let drafts = $state<{ primitiveId: string; text: string; speaker: string }[]>(
    [],
  );
  let requestVersion = 0;
  let observedRevision = '';
  let controller: AbortController | undefined;
  let closingAnimation: Animation | undefined;
  const languageNames = {
    original: 'Original',
    en: 'English',
    'zh-TW': 'Traditional Chinese',
  };
  let translated = $derived(
    new Map(
      translation?.translations.map((t) => [t.primitiveId, t.text]) ?? [],
    ),
  );
  let ready = $derived(
    language === 'original' || translation?.state === 'ready',
  );
  let filtered = $derived(
    texts.filter((p) => {
      const query = search.trim().toLocaleLowerCase();
      return (
        !query ||
        `${p.speaker ?? ''} ${displayText(p)}`
          .toLocaleLowerCase()
          .includes(query)
      );
    }),
  );
  let visible = $derived(filtered.slice(0, limit));
  let dirty = $derived(
    draftLabel !== stage.metadata.label ||
      draftTime !== baseTime ||
      drafts.some((d) => {
        const original = texts.find((p) => p.id === d.primitiveId);
        return (
          original &&
          (d.text !== original.text || d.speaker !== (original.speaker ?? ''))
        );
      }),
  );
  function time(ms: number) {
    const seconds = Math.floor(ms / 1000);
    return [
      Math.floor(seconds / 3600),
      Math.floor(seconds / 60) % 60,
      seconds % 60,
    ]
      .slice(seconds >= 3600 ? 0 : 1)
      .map((v) => String(v).padStart(2, '0'))
      .join(':');
  }
  function displayText(text: Text) {
    return language === 'original'
      ? text.text
      : (translated.get(text.id) ?? '');
  }
  function speakerLabel(text: Text) {
    return (
      text.speaker ??
      (text.role === 'notes'
        ? 'Speaker notes'
        : text.role === 'ocr'
          ? 'OCR (uncertain)'
          : text.role === 'asr'
            ? 'Unknown speaker'
            : 'Source text')
    );
  }
  function localTime(value: string | null) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  $effect(() => {
    const revision = stage.id;
    if (observedRevision === revision) return;
    observedRevision = revision;
    untrack(() => {
      if (baseRevision && baseRevision !== revision && editing) {
        editing = false;
        notice =
          'A new revision is available. Open Edit to work on the current transcript.';
      }
      requestVersion++;
      controller?.abort();
      language = 'original';
      translation = null;
      loading = false;
      canceling = false;
      error = '';
    });
  });
  onMount(() => {
    const timer = setInterval(() => {
      if (
        opened &&
        !canceling &&
        !loading &&
        language !== 'original' &&
        ['queued', 'processing'].includes(translation?.state ?? '')
      ) {
        void loadTranslation(false);
      }
    }, 2000);
    return () => {
      clearInterval(timer);
      controller?.abort();
      closingAnimation?.cancel();
    };
  });
  export async function openTranscript(primitiveId?: string) {
    closingAnimation?.cancel();
    search = '';
    highlight = primitiveId ?? '';
    if (primitiveId) {
      language = 'original';
      limit = Math.max(60, texts.findIndex((p) => p.id === primitiveId) + 1);
    }
    opened = true;
    await tick();
    if (!dialog?.open) {
      dialog?.showModal();
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dialog?.animate(
          [
            { opacity: 0, transform: 'translateY(14px) scale(.99)' },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ],
          { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' },
        );
      }
    }
    if (primitiveId) {
      await tick();
      const row = document.getElementById(rowId(primitiveId));
      row?.scrollIntoView({ block: 'center', behavior: 'instant' });
      row?.focus({ preventScroll: true });
    }
  }
  function closeTranscript() {
    if (!dialog || !dialog.open) return;
    closingAnimation?.cancel();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dialog.close();
      opened = false;
      return;
    }
    closingAnimation = dialog.animate(
      [
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(14px) scale(.99)' },
      ],
      { duration: 160, easing: 'ease-in' },
    );
    closingAnimation.onfinish = () => {
      dialog?.close();
      opened = false;
      closingAnimation?.cancel();
    };
  }
  function jump(text: Text, fromDialog = false) {
    if (text.locator.kind !== 'media') return;
    if (fromDialog) closeTranscript();
    onseek(text.locator.startMs);
  }
  async function chooseLanguage(value: typeof language) {
    if (editing) return;
    controller?.abort();
    requestVersion++;
    language = value;
    translation = null;
    error = '';
    loading = false;
    canceling = false;
    if (value !== 'original') await loadTranslation(true);
  }
  async function loadTranslation(enqueue: boolean) {
    if (language === 'original') return;
    const target = language;
    const revision = stage.id;
    const version = ++requestVersion;
    controller?.abort();
    controller = new AbortController();
    loading = true;
    error = '';
    const endpoint = `/api/uploads/${uploadId}/translations`;
    try {
      let response = await fetch(
        `${endpoint}?revisionId=${revision}&language=${target}`,
        { signal: controller.signal },
      );
      let result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Translation is unavailable.');
      if (
        enqueue &&
        ['not_requested', 'failed', 'canceled'].includes(result.state)
      ) {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revisionId: revision, language: target }),
          signal: controller.signal,
        });
        result = await response.json();
        if (!response.ok)
          throw new Error(result.error || 'Could not start translation.');
      }
      if (
        version === requestVersion &&
        revision === stage.id &&
        target === language
      )
        translation = result;
    } catch (e) {
      if (
        version === requestVersion &&
        !(e instanceof DOMException && e.name === 'AbortError')
      ) {
        error = e instanceof Error ? e.message : 'Translation is unavailable.';
      }
    } finally {
      if (version === requestVersion) loading = false;
    }
  }
  async function startEdit() {
    if (!canEdit) return;
    await chooseLanguage('original');
    search = '';
    baseRevision = stage.id;
    draftLabel = stage.metadata.label;
    draftTime = localTime(stage.metadata.sourceTime);
    baseTime = draftTime;
    drafts = texts.map((p) => ({
      primitiveId: p.id,
      text: p.text,
      speaker: p.speaker ?? '',
    }));
    editing = true;
    error = '';
    notice = '';
  }
  async function cancelTranslation() {
    if (
      !translation?.id ||
      canceling ||
      !['queued', 'processing'].includes(translation.state)
    )
      return;
    const id = translation.id;
    const revision = stage.id;
    const target = language;
    const version = ++requestVersion;
    controller?.abort();
    loading = false;
    canceling = true;
    error = '';
    try {
      const response = await fetch(
        `/api/uploads/${uploadId}/translations/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ translationId: id }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not cancel translation');
      if (
        version === requestVersion &&
        revision === stage.id &&
        target === language
      )
        translation = result;
    } catch (e) {
      if (version === requestVersion)
        error = e instanceof Error ? e.message : 'Could not cancel translation';
    } finally {
      if (version === requestVersion) canceling = false;
    }
  }
  async function save() {
    if (!editing || !dirty || saving) return;
    saving = true;
    error = '';
    try {
      const response = await fetch(`/api/uploads/${uploadId}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevisionId: baseRevision,
          label: draftLabel,
          sourceTime:
            draftTime === baseTime
              ? stage.metadata.sourceTime
              : draftTime
                ? new Date(draftTime).toISOString()
                : null,
          edits: drafts
            .filter((d) => {
              const p = texts.find((p) => p.id === d.primitiveId);
              return (
                p && (p.text !== d.text || (p.speaker ?? '') !== d.speaker)
              );
            })
            .map((d) => ({ ...d, speaker: d.speaker || null })),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not save corrections.');
      editing = false;
      await onupdated();
      notice = 'Corrections saved. Your previous revision is still in History.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save corrections.';
    } finally {
      saving = false;
    }
  }
  function download() {
    if (!ready) return;
    const heading = `${stage.metadata.label}\n${languageNames[language]}${language === 'original' ? '' : ' · Machine translation'}\nRevision: ${stage.id}\n\n`;
    const body = texts
      .map(
        (p) =>
          `${p.locator.kind === 'media' ? `[${time(p.locator.startMs)}] ` : ''}${p.speaker ? `${p.speaker}: ` : ''}${displayText(p)}`,
      )
      .join('\n\n');
    const url = URL.createObjectURL(
      new Blob([heading + body], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${stage.metadata.label.replace(/[\\/:*?"<>|]/g, '_')}-${language}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<section
  class="card transcript"
  id="spoken-transcript"
  aria-labelledby="transcript-heading"
>
  <div class="panel-heading">
    <div class="panel-title">
      <Icon name="transcript" />
      <h2 id="transcript-heading">
        {isVideo ? 'Spoken transcript' : 'Extracted text'}
      </h2>
    </div>
    <span class="segment-count">{texts.length} entries</span>
  </div>
  <div class="preview-list">
    {#each texts.slice(0, 4) as text}
      <article class="preview-turn">
        <div class="turn-head">
          <strong>{speakerLabel(text)}</strong>
          {#if text.locator.kind === 'media'}<button
              class="timestamp"
              onclick={() => jump(text)}
              aria-label={`Play from ${time(text.locator.startMs)}`}
              ><Icon name="play" size={12} />{time(
                text.locator.startMs,
              )}</button
            >{/if}
        </div>
        <p>{text.text}</p>
      </article>
    {/each}
    {#if !texts.length}<p class="muted">
        No extracted text is available for this revision.
      </p>{/if}
  </div>
  <div class="preview-footer">
    <span class="muted"
      >{texts.length > 4
        ? `Showing 4 of ${texts.length}`
        : `${texts.length} entries`}</span
    >
    <button class="secondary" onclick={() => openTranscript()}
      ><Icon name="expand" />Show full transcript</button
    >
  </div>
</section>

<dialog
  bind:this={dialog}
  class="transcript-dialog"
  aria-labelledby="reader-heading"
  oncancel={(event) => {
    event.preventDefault();
    closeTranscript();
  }}
  onclose={() => (opened = false)}
>
  <div class="reader-shell">
    <header class="reader-heading">
      <div>
        <span class="reader-file">{stage.metadata.label}</span>
        <h2 id="reader-heading">
          {isVideo ? 'Full transcript' : 'Full extracted text'}
        </h2>
      </div>
      <div class="reader-actions">
        {#if !editing}<Tooltip text="Download the language you are reading"
            ><button
              class="icon-button secondary"
              aria-label="Download transcript"
              onclick={download}
              disabled={!ready}><Icon name="download" /></button
            ></Tooltip
          >{/if}
        <Tooltip text="Close transcript (Escape)"
          ><button
            class="icon-button secondary"
            aria-label="Close transcript"
            onclick={closeTranscript}><Icon name="close" /></button
          ></Tooltip
        >
      </div>
    </header>
    <div class="reader-toolbar">
      {#if isVideo}<div
          class="segmented-control"
          role="group"
          aria-label="Transcript language"
        >
          {#each ['original', 'en', 'zh-TW'] as target}<button
              class:active={language === target}
              aria-pressed={language === target}
              disabled={editing}
              onclick={() => chooseLanguage(target as typeof language)}
              >{target === 'original'
                ? 'Original'
                : target === 'en'
                  ? 'EN'
                  : '繁中'}</button
            >{/each}
        </div>
        <Tooltip
          text="Translations are separate reading copies. Edit the original to correct spoken words."
          ><button
            type="button"
            class="language-help"
            aria-label="About transcript translation"
            ><Icon name="translate" /></button
          ></Tooltip
        >
      {/if}
      <label class="reader-search"
        ><Icon name="search" /><input
          aria-label="Search transcript"
          type="search"
          placeholder="Find a word or speaker"
          bind:value={search}
          oninput={() => (limit = 60)}
        /></label
      >
      {#if canEdit && !editing}<button class="secondary" onclick={startEdit}
          ><Icon name="edit" />{language === 'original'
            ? 'Edit'
            : 'Edit original'}</button
        >{/if}
    </div>
    {#if error}<div class="reader-message error" role="alert">
        {error}{#if language !== 'original'}<button
            class="secondary"
            onclick={() => loadTranslation(true)}
            ><Icon name="refresh" />Retry</button
          >{/if}
      </div>{/if}
    {#if notice}<p class="reader-message notice" role="status">{notice}</p>{/if}
    <div
      class="reader-content"
      lang={language === 'original' ? undefined : language}
    >
      {#if !ready}
        <div class="translation-state" role="status" aria-live="polite">
          <span class="translation-icon"
            ><Icon name="translate" size={30} /></span
          >
          <h3>
            {translation?.state === 'canceled'
              ? 'Translation canceled'
              : translation?.state === 'failed'
                ? 'Translation needs another try'
                : `Preparing ${languageNames[language]}`}
          </h3>
          <p class="muted">
            {translation?.state === 'canceled'
              ? 'Completed translation work is saved.'
              : translation?.state === 'failed'
                ? translation.error
                : 'You can keep reading the original while this is prepared.'}
          </p>
          {#if translation}<div class="translation-progress">
              <ProgressBar
                value={translation.progressPercent ??
                  Math.round(
                    (translation.completedSegments /
                      Math.max(translation.totalSegments, 1)) *
                      100,
                  )}
                label={`${translation.completedSegments} / ${translation.totalSegments} entries`}
                ariaLabel="Translation progress"
                state={translation.state}
              />
            </div>{/if}
          <div class="actions">
            {#if ['failed', 'canceled'].includes(translation?.state ?? '')}<button
                onclick={() => loadTranslation(true)}
                ><Icon name="refresh" />{translation?.state === 'canceled'
                  ? 'Resume translation'
                  : 'Retry translation'}</button
              >{/if}
            {#if ['queued', 'processing'].includes(translation?.state ?? '')}<button
                class="secondary"
                disabled={canceling}
                onclick={cancelTranslation}
                ><Icon name="close" />{canceling
                  ? 'Stopping...'
                  : 'Cancel translation'}</button
              >{/if}<button
              class="secondary"
              onclick={() => chooseLanguage('original')}>Read original</button
            >
          </div>
        </div>
      {:else}
        {#if editing}<div class="edit-metadata">
            <Disclosure title="File details" icon="file"
              ><div class="metadata-fields">
                <label
                  >File label<input
                    bind:value={draftLabel}
                    maxlength="500"
                  /></label
                ><label
                  >Meeting time (optional)<input
                    type="datetime-local"
                    bind:value={draftTime}
                  /></label
                >
              </div></Disclosure
            >
          </div>{/if}
        {#if !filtered.length}<div class="empty-search">
            <Icon name="search" size={28} />
            <h3>No matching entries</h3>
            <button class="secondary" onclick={() => (search = '')}
              >Clear search</button
            >
          </div>{/if}
        {#each visible as text, index (text.id)}{@const draft = drafts.find(
            (d) => d.primitiveId === text.id,
          )}
          <article
            class="reader-turn"
            class:highlighted={highlight === text.id}
            id={rowId(text.id)}
            tabindex="-1"
          >
            <div class="reader-turn-meta">
              <span class="entry-number">{texts.indexOf(text) + 1}</span>
              {#if text.locator.kind === 'media'}<button
                  class="timestamp"
                  onclick={() => jump(text, true)}
                  aria-label={`Play original from ${time(text.locator.startMs)}`}
                  ><Icon name="play" size={12} />{time(
                    text.locator.startMs,
                  )}</button
                >{/if}
              {#if editing && draft && isVideo}<input
                  aria-label={`Speaker for entry ${index + 1}`}
                  class="speaker-input"
                  bind:value={draft.speaker}
                  placeholder="Speaker"
                  maxlength="100"
                />{:else}<strong>{speakerLabel(text)}</strong>{/if}
            </div>
            {#if editing && draft}<textarea
                aria-label={`Text for entry ${index + 1}`}
                rows="3"
                bind:value={draft.text}></textarea>{:else}<p>
                {displayText(text)}
              </p>{/if}
          </article>
        {/each}
        {#if filtered.length > limit}<div class="load-more">
            <span class="muted"
              >{visible.length} of {filtered.length} entries</span
            ><button class="secondary" onclick={() => (limit += 60)}
              ><Icon name="chevron-down" />Show more</button
            >
          </div>{/if}
      {/if}
    </div>
    <footer class="reader-footer">
      <span class="muted"
        >{editing
          ? 'Corrections create a new revision.'
          : language === 'original'
            ? `${texts.length} entries · Original evidence`
            : `${texts.length} entries · Machine translation`}</span
      >
      <div class="actions">
        {#if editing}<button
            class="secondary"
            disabled={saving}
            onclick={() => {
              editing = false;
              error = '';
            }}>Cancel editing</button
          ><button disabled={saving || !dirty} onclick={save}
            ><Icon name="save" />{saving
              ? 'Saving...'
              : 'Save corrections'}</button
          >{:else}<button class="secondary" onclick={closeTranscript}
            >Done</button
          >{/if}
      </div>
    </footer>
  </div>
</dialog>

<style>
  .transcript {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
  }
  .panel-heading,
  .panel-title,
  .turn-head,
  .preview-footer,
  .reader-actions,
  .reader-toolbar,
  .reader-turn-meta,
  .reader-footer {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }
  .panel-heading {
    justify-content: space-between;
    margin-bottom: 0.7rem;
  }
  .panel-title h2 {
    margin: 0;
    font-size: 1rem;
  }
  .segment-count,
  .preview-footer {
    font-size: 0.76rem;
  }
  .segment-count {
    color: var(--text-muted, #787774);
    white-space: nowrap;
  }
  .preview-list {
    flex: 1;
  }
  .preview-turn {
    padding: 0.8rem 0;
    border-bottom: 1px solid #eaeaea;
  }
  .turn-head {
    justify-content: space-between;
    font-size: 0.74rem;
  }
  .preview-turn p {
    font-size: 0.88rem;
    margin: 0.3rem 0 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    line-height: 1.6;
  }
  .timestamp {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--canvas, #f7f6f3);
    color: var(--text-muted, #66645f);
    padding: 0.2rem 0.45rem;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    white-space: nowrap;
  }
  .preview-footer {
    justify-content: space-between;
    padding-top: 1.05rem;
    gap: 0.8rem;
  }
  .preview-footer button {
    font-size: 0.78rem;
  }
  .transcript-dialog {
    max-width: min(1440px, calc(100vw - 2rem));
    width: calc(100vw - 2rem);
    height: calc(100dvh - 2rem);
    max-height: calc(100dvh - 2rem);
    margin: auto;
    padding: 0;
    border: 1px solid #eaeaea;
    border-radius: 12px;
    color: var(--text, #2f3437);
    background: #fbfbfa;
  }
  .transcript-dialog::backdrop {
    background: rgba(29, 29, 27, 0.34);
  }
  .reader-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .reader-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.2rem 1.75rem;
    gap: 1rem;
    background: white;
    border-bottom: 1px solid #eaeaea;
  }
  .reader-heading h2 {
    margin: 0.18rem 0 0;
    font-size: 1.4rem;
    letter-spacing: -0.035em;
  }
  .reader-file {
    display: block;
    color: var(--text-muted, #787774);
    font-size: 0.74rem;
    max-width: 75vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reader-toolbar {
    padding: 0.8rem 1.75rem;
    border-bottom: 1px solid #eaeaea;
    background: white;
    flex-wrap: wrap;
  }
  .segmented-control {
    display: inline-flex;
    padding: 3px;
    border-radius: 7px;
    background: #f0efec;
    gap: 2px;
  }
  .segmented-control button {
    background: transparent;
    color: #65635e;
    padding: 0.45rem 0.8rem;
    font-size: 0.8rem;
    border-radius: 5px;
  }
  .segmented-control button.active {
    color: #252520;
    background: #fff;
  }
  .language-help {
    display: flex;
    padding: 0.4rem;
    color: #787774;
    background: transparent;
  }
  .reader-search {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.65rem;
    border: 1px solid #eaeaea;
    border-radius: 6px;
    min-width: 14rem;
  }
  .reader-search input {
    border: 0;
    padding: 0;
    background: transparent;
    font-size: 0.82rem;
    min-width: 0;
    width: 100%;
  }
  .reader-content {
    flex: 1;
    overflow: auto;
    overscroll-behavior: contain;
    min-height: 0;
    padding: 1.75rem max(1.75rem, calc((100% - 920px) / 2));
  }
  .reader-turn {
    padding: 1.35rem 0;
    border-bottom: 1px solid #eaeaea;
    scroll-margin-top: 2rem;
  }
  .reader-turn.highlighted {
    background: #fbf3db;
    border-radius: 6px;
    padding: 1.35rem 1rem;
  }
  .reader-turn-meta {
    font-size: 0.78rem;
    margin-bottom: 0.6rem;
  }
  .reader-turn p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 1rem;
    line-height: 1.85;
    margin: 0;
  }
  .entry-number {
    width: 1.8rem;
    font-size: 0.7rem;
    color: #96938c;
    font-variant-numeric: tabular-nums;
  }
  .speaker-input {
    width: 8rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.8rem;
  }
  textarea {
    width: 100%;
    line-height: 1.8;
    resize: vertical;
    padding: 0.8rem;
  }
  .reader-footer {
    justify-content: space-between;
    padding: 0.85rem 1.75rem;
    background: white;
    border-top: 1px solid #eaeaea;
    font-size: 0.76rem;
  }
  .reader-footer button {
    font-size: 0.8rem;
  }
  .reader-message {
    margin: 0.6rem 1.75rem 0;
    font-size: 0.85rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.8rem;
  }
  .metadata-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  .load-more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1.5rem 0;
    font-size: 0.8rem;
  }
  .translation-state,
  .empty-search {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    min-height: 60vh;
    gap: 0.6rem;
  }
  .translation-state h3 {
    margin: 0.5rem 0 0;
    font-size: 1.25rem;
  }
  .translation-state p {
    max-width: 34rem;
  }
  .translation-icon {
    display: grid;
    place-items: center;
    width: 4rem;
    height: 4rem;
    background: var(--blue-soft);
    color: var(--accent);
    border-radius: 12px;
  }
  .translation-progress {
    width: min(24rem, 90%);
  }
  @media (max-width: 700px) {
    .transcript-dialog {
      width: 100vw;
      max-width: 100vw;
      height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
      border: 0;
    }
    .reader-heading,
    .reader-toolbar,
    .reader-footer {
      padding: 0.85rem 1rem;
    }
    .reader-heading h2 {
      font-size: 1.15rem;
    }
    .reader-content {
      padding: 0.5rem 1rem;
    }
    .reader-search {
      order: 3;
      width: 100%;
      margin: 0;
    }
    .reader-toolbar > button {
      margin-left: auto;
    }
    .reader-footer {
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 0.6rem;
    }
    .reader-footer > span {
      max-width: 100%;
      width: 100%;
    }
    .reader-footer .actions {
      width: 100%;
    }
    .preview-footer {
      flex-wrap: wrap;
    }
    .metadata-fields {
      grid-template-columns: 1fr;
    }
  }
</style>
