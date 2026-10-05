<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Stage } from '../../../lib/server/contracts';
  import { isUsableCandidateName } from '../../../lib/speaker-names';
  let { data } = $props();
  let detail = $state(untrack(() => data));
  let error = $state(''),
    notice = $state(''),
    selection = $state('current'),
    editing = $state(false),
    saving = $state(false);
  let player = $state<HTMLVideoElement>();
  let draftLabel = $state(''),
    draftTime = $state('');
  let edits = $state<{ primitiveId: string; text: string; speaker: string }[]>(
    [],
  );
  $effect(() => {
    detail = data;
    selection = 'current';
    editing = false;
  });
  let stage = $derived(
    detail.revisions.find(
      (r) =>
        r.id ===
        (selection === 'current' ? detail.upload.currentRevisionId : selection),
    )?.manifest,
  );
  let speakerSuggestions = $derived(
    stage?.speakerSuggestions?.filter((s) =>
      isUsableCandidateName(s.candidateName),
    ) ?? [],
  );
  let isVideo = $derived(
    /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(detail.upload.filename),
  );
  let current = $derived(stage?.id === detail.upload.currentRevisionId);
  onMount(() => {
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/uploads/${detail.upload.id}`);
        if (r.ok) detail = await r.json();
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  });
  async function retry(contextOnly = false) {
    error = '';
    const r = await fetch(`/api/uploads/${detail.upload.id}/retry`, {
      method: 'POST',
      ...(contextOnly && stage
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputRevisionId: stage.id }),
          }
        : {}),
    });
    if (!r.ok) error = (await r.json()).error;
    else
      notice = contextOnly
        ? 'Visual context review queued. Existing speech will be preserved.'
        : 'Reprocessing queued. Your current revision remains available.';
  }
  function seek(ms: number) {
    if (player) {
      player.currentTime = ms / 1000;
      player.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  function startEdit(value: Stage) {
    editing = true;
    draftLabel = value.metadata.label;
    draftTime = value.metadata.sourceTime ?? '';
    edits = value.primitives
      .filter((p) => p.kind === 'text')
      .map((p) => ({
        primitiveId: p.id,
        text: p.kind === 'text' ? p.text : '',
        speaker: p.kind === 'text' ? (p.speaker ?? '') : '',
      }));
  }
  async function save() {
    if (!stage) return;
    saving = true;
    error = '';
    try {
      const r = await fetch(`/api/uploads/${detail.upload.id}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRevisionId: stage.id,
          label: draftLabel,
          sourceTime: draftTime ? new Date(draftTime).toISOString() : null,
          edits: edits.map((e) => ({ ...e, speaker: e.speaker || null })),
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      detail = await (await fetch(`/api/uploads/${detail.upload.id}`)).json();
      selection = 'current';
      editing = false;
      notice =
        'Correction saved as a new staging revision. Memory is unchanged.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Correction failed';
    } finally {
      saving = false;
    }
  }
</script>

<a href="/">← Staging files</a>
<div class="heading">
  <div>
    <h1>{stage?.metadata.label || detail.upload.metadata.label}</h1>
    <p class="muted">
      {detail.upload.filename} · uploaded by {detail.upload.metadata.uploader}
    </p>
  </div>
  <span class="badge">Not pushed to memory</span>
</div>
<div class="run">
  <span class="badge">{detail.run.state.replaceAll('_', ' ')}</span><span
    >{detail.run.progress}</span
  >{#if ['failed', 'ready', 'ready_with_warnings'].includes(detail.run.state)}<button
      class="secondary"
      onclick={() => retry()}>Reprocess original</button
    >{#if isVideo && current}<button
        class="secondary"
        onclick={() => retry(true)}>Revisit visual context</button
      >{/if}{/if}<a
    href={`/api/assets/${detail.asset.id}`}
    target="_blank"
    rel="noreferrer">Open original source ↗</a
  >
</div>
{#if detail.run.error}<p class="error">{detail.run.error}</p>{/if}{#if error}<p
    class="error"
  >
    {error}
  </p>{/if}{#if notice}<p class="notice" role="status">{notice}</p>{/if}
{#if stage}
  <div class="toolbar">
    <label
      >Staging revision<select
        bind:value={selection}
        onchange={() => (editing = false)}
        ><option value="current">Current revision</option
        >{#each detail.revisions as revision}<option value={revision.id}
            >{new Date(revision.createdAt).toLocaleString()} · {revision.id.slice(
              0,
              8,
            )}</option
          >{/each}</select
      ></label
    ><span class="muted"
      >{stage.id.slice(0, 8)} · {stage.provenance.adapter}</span
    >
    <div class="exports">
      <a href={`/api/uploads/${detail.upload.id}/export?revision=${stage.id}`}
        >Export Markdown</a
      ><a
        href={`/api/uploads/${detail.upload.id}/export?revision=${stage.id}&format=json`}
        >JSON</a
      ><a
        href={`/api/uploads/${detail.upload.id}/export?revision=${stage.id}&format=zip`}
        >Offline bundle</a
      >
    </div>
  </div>
  {#if stage.coverage.warnings.length}<details class="warning" open>
      <summary
        >Coverage and warnings ({stage.coverage.warnings.length}){stage.coverage
          .complete
          ? ''
          : ' · Partial extraction'}</summary
      >
      <ul>
        {#each stage.coverage.warnings as warning}<li>{warning}</li>{/each}
      </ul>
    </details>{/if}
  {#if stage.context}<section class="card context-review">
      <h2>Transcript questions and frame searches</h2>
      <p class="muted small">
        Read {stage.context.readSegments}/{stage.context.totalSegments} speech segments.
        Searches follow missing context in the transcript.
      </p>
      <details>
        <summary
          >Review {stage.context.questions.length} questions and searches</summary
        >
        {#each stage.context.questions as question}<details
            class="context-question"
          >
            <summary
              >{question.question}
              <span class="badge">{question.status}</span></summary
            >
            <p class="small">
              {question.purpose.replaceAll(
                '_',
                ' ',
              )}{#each question.transcriptIds as ref}
                · <a href={`#text-${ref}`}>Related speech</a>{/each}
            </p>
            {#if question.explanation}<p>{question.explanation}</p>{/if}
            {#each question.searches as search}<p class="small">
                {search.reason}{#each search.timesMs as ms}
                  · <button class="timestamp" onclick={() => seek(ms)}
                    >{(ms / 1000).toFixed(2)}s</button
                  >{/each}
              </p>
              <div class="frames">
                {#each search.frameIds as ref}{@const frame =
                    stage.primitives.find(
                      (p) => p.id === ref,
                    )}{#if frame?.kind === 'image'}<a
                      href={`/api/assets/${frame.assetId}`}
                      target="_blank"
                      rel="noreferrer"
                      ><img
                        class="search-frame"
                        src={`/api/assets/${frame.assetId}`}
                        alt={`Searched frame at ${((frame.actualMs ?? 0) / 1000).toFixed(2)} seconds`}
                      /></a
                    >{/if}{/each}
              </div>
            {/each}
          </details>{/each}
      </details>
    </section>{/if}
  {#if speakerSuggestions.length}<section class="card context-review">
      <h2>Tentative speaker names <span class="badge">Unverified</span></h2>
      <p class="muted small">
        Original speaker codes are preserved. These guesses can be wrong;
        confidence is the model's assessment.
      </p>
      <details>
        <summary
          >Review {speakerSuggestions.length} tentative name suggestions</summary
        >
        {#each speakerSuggestions as suggestion}<article class="turn">
            <strong
              >{suggestion.speaker} → possibly {suggestion.candidateName}</strong
            >
            <span class="badge">{suggestion.confidence}</span>
            <p>{suggestion.reason}</p>
            <p class="small muted">
              {suggestion.basis.replaceAll(
                '_',
                ' ',
              )}{#each suggestion.transcriptIds as ref}
                · <a href={`#text-${ref}`}>Name evidence</a
                >{/each}{#each suggestion.frameIds as ref}{@const frame =
                  stage.primitives.find(
                    (p) => p.id === ref,
                  )}{#if frame?.kind === 'image'}
                  · <a
                    href={`/api/assets/${frame.assetId}`}
                    target="_blank"
                    rel="noreferrer">Frame evidence</a
                  >{/if}{/each}
            </p>
          </article>{/each}
      </details>
    </section>{/if}
  <div class="workspace">
    <section class="source card">
      <h2>Original evidence</h2>
      {#if isVideo}<video controls preload="metadata" bind:this={player}
          ><source src={`/api/assets/${detail.asset.id}`} /><track
            kind="captions"
            src={`/api/uploads/${detail.upload.id}/captions?revision=${stage.id}`}
            label="Transcript"
            srclang="en"
          /></video
        >
        <p class="muted small">
          Click a transcript timestamp or frame to seek the original video.
        </p>{:else}<a href={`/api/assets/${detail.asset.id}`}
          >Open the original file</a
        >{/if}
      <dl>
        <dt>Source time</dt>
        <dd>{stage.metadata.sourceTime ?? 'Unknown'}</dd>
        <dt>Uploaded</dt>
        <dd>{new Date(stage.metadata.uploadedAt).toLocaleString()}</dd>
        <dt>Model</dt>
        <dd>{stage.provenance.model ?? 'Native text'}</dd>
      </dl>
    </section>
    <section class="card transcript">
      <div class="section-head">
        <h2>{isVideo ? 'Spoken transcript' : 'Extracted text'}</h2>
        {#if current && !editing}<button
            class="secondary"
            onclick={() => startEdit(stage!)}>Correct text / labels</button
          >{/if}
      </div>
      {#if editing}<form
          onsubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div class="edit-meta">
            <label>File label<input bind:value={draftLabel} /></label><label
              >Source time (ISO, optional)<input
                bind:value={draftTime}
                placeholder="2026-10-05T09:00:00Z"
              /></label
            >
          </div>
          {#each edits as edit}<div class="edit-turn">
              <label
                >Speaker label<input
                  bind:value={edit.speaker}
                  placeholder="Unknown"
                /></label
              ><label
                >Transcript text<textarea rows="3" bind:value={edit.text}
                ></textarea></label
              >
            </div>{/each}
          <div class="actions">
            <button disabled={saving}
              >{saving ? 'Saving…' : 'Save correction'}</button
            ><button
              type="button"
              class="secondary"
              onclick={() => (editing = false)}>Cancel</button
            >
          </div>
        </form>
      {:else}{#each stage.primitives as primitive}{#if primitive.kind === 'text'}<article
              id={`text-${primitive.id}`}
              class="turn"
            >
              <div class="turn-head">
                <strong>{primitive.speaker ?? primitive.role}</strong
                >{#if primitive.locator.kind === 'media'}<button
                    class="timestamp"
                    onclick={() =>
                      seek(
                        primitive.locator.kind === 'media'
                          ? primitive.locator.startMs
                          : 0,
                      )}
                    >{(primitive.locator.startMs / 1000).toFixed(2)}–{(
                      primitive.locator.endMs / 1000
                    ).toFixed(2)}s</button
                  >{/if}
              </div>
              <p>{primitive.text}</p>
              {#each stage.annotations.filter( (a) => a.transcriptIds.includes(primitive.id) ) as annotation}<a
                  class="visual-ref"
                  href={`#annotation-${annotation.id}`}>↳ Visual context</a
                >{/each}
            </article>{/if}{/each}{/if}
    </section>
  </div>
  <section class="visuals">
    <h2>Visual context <span class="badge">Model observations</span></h2>
    {#if !stage.annotations.length}<p class="muted">
        No validated visual observations are available for this revision.
      </p>{/if}{#each stage.annotations as annotation}<article
        class="card annotation"
        id={`annotation-${annotation.id}`}
      >
        <p>{annotation.text}</p>
        <div class="frames">
          {#each annotation.frameIds as ref}{@const frame =
              stage.primitives.find(
                (p) => p.id === ref,
              )}{#if frame?.kind === 'image'}<figure id={`frame-${frame.id}`}>
                <button class="frame" onclick={() => seek(frame.actualMs ?? 0)}
                  ><img
                    src={`/api/assets/${frame.assetId}`}
                    alt={`Evidence frame at ${((frame.actualMs ?? 0) / 1000).toFixed(2)} seconds`}
                  /></button
                >
                <figcaption>
                  Actual {((frame.actualMs ?? 0) / 1000).toFixed(2)}s ·
                  requested {((frame.requestedMs ?? 0) / 1000).toFixed(2)}s ·
                  <a
                    href={`/api/assets/${frame.assetId}`}
                    target="_blank"
                    rel="noreferrer">Open frame</a
                  >
                </figcaption>
              </figure>{/if}{/each}
        </div>
        <p class="small muted">
          {annotation.model} · {annotation.promptVersion}{#each annotation.transcriptIds as ref}
            · <a href={`#text-${ref}`}>Related speech</a>{/each}
        </p>
      </article>{/each}
  </section>
{:else}<div class="card waiting">
    <h2>Preparing staging</h2>
    <p class="muted">
      You can leave this page while Interpreter works. Progress is saved.
    </p>
  </div>{/if}

<style>
  .context-review {
    margin: 20px 0;
  }
  .context-question {
    border-top: 1px solid #edf0f4;
    padding: 12px 0;
  }
  .search-frame {
    width: 240px;
    max-width: 100%;
    border-radius: 6px;
  }
  h1 {
    margin-top: 20px;
  }
  .heading {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: center;
  }
  .run {
    display: flex;
    align-items: center;
    gap: 15px;
    flex-wrap: wrap;
    margin: 18px 0;
  }
  .run a {
    margin-left: auto;
  }
  .toolbar {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    align-items: center;
    margin: 26px 0 16px;
  }
  select {
    font: inherit;
    padding: 8px;
    border: 1px solid #ccd6e2;
    border-radius: 7px;
    background: white;
  }
  .toolbar label {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .exports {
    margin-left: auto;
    display: flex;
    gap: 15px;
  }
  .workspace {
    display: grid;
    grid-template-columns: minmax(280px, 1fr) minmax(350px, 1.2fr);
    gap: 24px;
    margin-top: 24px;
    align-items: start;
  }
  video {
    width: 100%;
    border-radius: 8px;
    background: #101b2a;
  }
  .source {
    position: sticky;
    top: 20px;
  }
  .small {
    font-size: 12px;
  }
  dl {
    font-size: 12px;
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 9px;
  }
  dt {
    color: #66768b;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    gap: 15px;
    align-items: center;
    margin-bottom: 16px;
  }
  .section-head h2 {
    margin: 0;
  }
  .section-head button {
    font-size: 12px;
  }
  .turn {
    border-top: 1px solid #edf0f4;
    padding: 16px 0;
  }
  .turn-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
  }
  .timestamp {
    background: none;
    color: #235dba;
    font-size: 12px;
    padding: 0;
  }
  .turn p {
    white-space: pre-wrap;
    margin: 8px 0;
  }
  .visual-ref {
    font-size: 12px;
  }
  .visuals {
    margin: 28px 0;
  }
  .annotation {
    margin-bottom: 18px;
  }
  .frames {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
  }
  figure {
    margin: 0;
    max-width: 440px;
    flex: 1;
    min-width: 220px;
  }
  .frame {
    padding: 0;
    background: none;
    width: 100%;
    display: block;
  }
  .frame img {
    width: 100%;
    border-radius: 6px;
    display: block;
  }
  figcaption {
    font-size: 11px;
    color: #66768b;
    margin-top: 7px;
  }
  .notice {
    background: #e9f4ed;
    color: #2f6545;
    padding: 12px;
    border-radius: 7px;
  }
  .edit-meta,
  .edit-turn {
    display: grid;
    gap: 12px;
    margin-bottom: 18px;
  }
  .edit-turn {
    border-top: 1px solid #edf0f4;
    padding-top: 16px;
  }
  .actions {
    display: flex;
    gap: 12px;
  }
  .waiting {
    margin-top: 24px;
  }
  summary {
    cursor: pointer;
  }
  ul {
    margin-bottom: 0;
  }
  @media (max-width: 900px) {
    .workspace {
      grid-template-columns: 1fr;
    }
    .source {
      position: static;
    }
    .heading {
      display: block;
    }
    .run a {
      margin-left: 0;
    }
    .exports {
      margin-left: 0;
    }
  }
</style>
