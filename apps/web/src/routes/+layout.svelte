<script lang="ts">
  let { children } = $props();
</script>

<svelte:head><title>Chronicler · Research workspace</title></svelte:head>
<div class="shell">
  <header>
    <a class="brand" href="/">◈ <strong>Chronicler</strong></a><span
      class="local"
      ><a href="/">Staging</a> · <a href="/memory">Memory</a> · LOCAL WORKSPACE</span
    >
  </header>
  <main>{@render children()}</main>
  <footer>Raw evidence → Interpreter → Staging → Memory</footer>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    background: #f7f8fa;
    color: #172536;
    font-family: Inter, system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.5;
  }
  :global(a) {
    color: #235dba;
    text-decoration: none;
  }
  :global(a:hover) {
    text-decoration: underline;
  }
  .shell {
    max-width: 1240px;
    margin: auto;
    padding: 0 32px;
  }
  header {
    height: 88px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #dfe5ec;
  }
  .brand {
    color: #172536;
    font-size: 23px;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .local {
    font-size: 11px;
    letter-spacing: 2px;
    color: #7a8796;
  }
  main {
    padding: 38px 0;
  }
  footer {
    color: #7a8796;
    font-size: 12px;
    padding: 28px 0;
    border-top: 1px solid #dfe5ec;
  }
  :global(h1) {
    font-size: 32px;
    letter-spacing: -1px;
    margin: 0 0 8px;
  }
  :global(h2) {
    font-size: 18px;
    margin: 0 0 16px;
  }
  :global(p) {
    margin: 8px 0 16px;
  }
  :global(button) {
    cursor: pointer;
    background: #235dba;
    color: white;
    border: 0;
    border-radius: 7px;
    padding: 10px 17px;
    font: inherit;
    font-weight: 600;
  }
  :global(button:disabled) {
    opacity: 0.5;
    cursor: default;
  }
  :global(input),
  :global(textarea) {
    font: inherit;
    padding: 10px;
    border: 1px solid #ccd6e2;
    border-radius: 6px;
    background: white;
    max-width: 100%;
  }
  :global(label) {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: #465972;
  }
  :global(.card) {
    background: white;
    border: 1px solid #dfe5ec;
    border-radius: 12px;
    padding: 24px;
  }
  :global(.muted) {
    color: #66768b;
  }
  :global(.error) {
    color: #a93434;
    background: #fff1f1;
    padding: 12px;
    border-radius: 7px;
  }
  :global(.badge) {
    font-size: 12px;
    background: #edf2f9;
    border-radius: 20px;
    padding: 4px 10px;
    display: inline-block;
  }
  :global(.warning) {
    color: #79591b;
    background: #fff6d9;
    padding: 12px;
    border-radius: 7px;
  }
  :global(.secondary) {
    background: #eaf0f8;
    color: #235dba;
  }
  @media (max-width: 700px) {
    .shell {
      padding: 0 16px;
    }
    header {
      height: 70px;
    }
    .local {
      display: none;
    }
    main {
      padding: 24px 0;
    }
  }
</style>
