<script lang="ts">
  import { onMount, untrack } from 'svelte';
  let { data } = $props();
  let uploads = $state(untrack(() => data.uploads));
  let busy = $state(false),
    message = $state('');
  $effect(() => {
    uploads = data.uploads;
  });
  onMount(() => {
    const timer = setInterval(async () => {
      try {
        const r = await fetch('/api/uploads');
        if (r.ok) uploads = await r.json();
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  });
  async function upload(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    message = '';
    const form = event.currentTarget as HTMLFormElement;
    try {
      const r = await fetch('/api/uploads', {
        method: 'POST',
        body: new FormData(form),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      form.reset();
      uploads = await (await fetch('/api/uploads')).json();
    } catch (e) {
      message = e instanceof Error ? e.message : 'Upload failed';
    } finally {
      busy = false;
    }
  }
</script>

<div class="intro">
  <div>
    <h1>Your evidence, ready for review.</h1>
    <p class="muted">
      Upload source files. Interpreter prepares them in staging.
    </p>
  </div>
  <div class="memory">
    <strong>{data.memoryCount}</strong><span>memory commits</span>
  </div>
</div>
<section class="card">
  <h2>Add source files</h2>
  <form onsubmit={upload}>
    <label class="file"
      >Source file<input required name="file" type="file" /></label
    ><label>Uploaded by<input name="uploader" value="local" /></label><label
      >Label (optional)<input
        name="label"
        placeholder="Project meeting"
      /></label
    ><button disabled={busy}>{busy ? 'Uploading…' : 'Upload to staging'}</button
    >
  </form>
  {#if message}<p class="error">{message}</p>{/if}
  <p class="hint">
    Files stay in staging until you explicitly push them to memory. Memory
    ingestion will be available in a later step.
  </p>
</section>
<section class="files">
  <h2>Staging files <span class="badge">{uploads.length}</span></h2>
  {#if !uploads.length}<div class="card empty">
      No source files yet. Start with a text file or meeting recording.
    </div>{:else}<div class="list">
      {#each uploads as file}<a class="row" href={`/staging/${file.id}`}
          ><span class="icon"
            >{file.filename.match(/\.(mp4|mov|mkv|webm)$/i) ? '▶' : '▤'}</span
          ><span class="details"
            ><strong>{file.metadata.label || file.filename}</strong><small
              >{file.filename} · {file.metadata.uploader} · {(
                file.bytes / 1024
              ).toFixed(1)} KB</small
            ></span
          ><span class="status"
            ><span class="badge"
              >{file.run?.state.replaceAll('_', ' ') || 'queued'}</span
            ><small>{file.run?.progress}</small></span
          ><span>→</span></a
        >{/each}
    </div>{/if}
</section>

<style>
  .intro {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 24px;
  }
  .memory {
    display: grid;
    text-align: right;
    align-content: center;
  }
  .memory strong {
    font-size: 28px;
  }
  .memory span {
    font-size: 12px;
    color: #66768b;
  }
  form {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    align-items: end;
  }
  .file {
    flex: 2;
    min-width: 230px;
  }
  form label {
    flex: 1;
    min-width: 150px;
  }
  .hint {
    font-size: 12px;
    color: #66768b;
    margin-bottom: 0;
  }
  .files {
    margin-top: 34px;
  }
  .list {
    background: white;
    border: 1px solid #dfe5ec;
    border-radius: 12px;
    overflow: hidden;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 22px;
    color: #172536;
    border-bottom: 1px solid #edf0f4;
  }
  .row:last-child {
    border: 0;
  }
  .row:hover {
    background: #f9fbfd;
    text-decoration: none;
  }
  .icon {
    background: #edf2f9;
    color: #235dba;
    border-radius: 8px;
    padding: 11px 16px;
  }
  .details {
    display: grid;
    flex: 1;
  }
  .details small,
  .status small {
    color: #66768b;
    font-size: 12px;
  }
  .status {
    display: grid;
    text-align: right;
    gap: 5px;
  }
  .empty {
    color: #66768b;
    text-align: center;
    padding: 44px;
  }
  @media (max-width: 700px) {
    .intro {
      display: block;
    }
    .memory {
      display: none;
    }
    .row {
      gap: 12px;
      padding: 16px;
    }
    .status small {
      display: none;
    }
  }
</style>
