<script lang="ts">
  import { onMount, untrack } from 'svelte';
  let {data}=$props(); let detail=$state(untrack(()=>data));let error=$state('');
  $effect(()=>{detail=data;});
  let stage=$derived(detail.revisions.find(r=>r.id===detail.upload.currentRevisionId)?.manifest);
  onMount(()=>{const t=setInterval(async()=>{const r=await fetch(`/api/uploads/${detail.upload.id}`);if(r.ok)detail=await r.json();},2000);return()=>clearInterval(t);});
  async function retry(){const r=await fetch(`/api/uploads/${detail.upload.id}/retry`,{method:'POST'});if(!r.ok)error=(await r.json()).error;}
</script>
<a href="/">← Staging files</a><h1>{detail.upload.metadata.label}</h1><p class="muted">{detail.upload.filename} · uploaded by {detail.upload.metadata.uploader}</p>
<div class="card"><span class="badge">{detail.run.state.replaceAll('_',' ')}</span><p>{detail.run.progress}</p>{#if detail.run.error}<p class="error">{detail.run.error}</p>{/if}{#if error}<p class="error">{error}</p>{/if}{#if ['failed','ready','ready_with_warnings'].includes(detail.run.state)}<button class="secondary" onclick={retry}>Reprocess original</button>{/if}<p><a href={`/api/assets/${detail.asset.id}`}>Open original source</a></p></div>
{#if stage}<section class="card extracted"><h2>Extracted text</h2>{#each stage.primitives as primitive}{#if primitive.kind==='text'}<pre>{primitive.text}</pre>{/if}{/each}<p class="muted">Staging revision {stage.id} · Not pushed to memory</p></section>{/if}
<style>h1{margin-top:20px}.extracted{margin-top:24px}pre{white-space:pre-wrap;font:inherit}</style>
