<script>
  import { onMount } from 'svelte';
  import { applyUpdate, onUpdateReady } from '$lib/pwa.js';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import X from '@lucide/svelte/icons/x';

  let { children } = $props();
  let waiting = $state(null);

  onMount(() => onUpdateReady((worker) => { waiting = worker; }));
</script>

<svelte:head><title>French Cognates</title></svelte:head>

<main>{@render children()}</main>

{#if waiting}
  <div class="update" role="status">
    <span>New version ready</span>
    <button onclick={() => applyUpdate(waiting)}><RefreshCw size={14} /> Reload</button>
    <button class="later" onclick={() => { waiting = null; }} aria-label="Later"><X size={16} /></button>
  </div>
{/if}

<style>
  :global(:root) {
    --bg: #fbfaf7; --panel: #fff; --ink: #1c1c1a; --muted: #6b6a66;
    --line: #e6e3dc; --accent: #1d4ed8; --good: #15803d; --bad: #b91c1c;
    --warn: #b45309;
    /* Gender, wherever a noun is shown: feminine, masculine, plural. */
    --fem: #dc2626; --masc: #1d4ed8; --plur: #15803d;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #16171a; --panel: #1f2125; --ink: #e9e8e4; --muted: #9a9892;
      --line: #2e3136; --accent: #7ea2ff; --good: #6ee7a0; --bad: #fca5a5;
      --warn: #fbbf24;
      --fem: #f87171; --masc: #7ea2ff; --plur: #6ee7a0;
    }
  }
  :global(body) {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  /* Lucide icons sit on the text baseline inside buttons and labels. */
  :global(svg.lucide) { vertical-align: -0.18em; flex-shrink: 0; }
  :global(button) { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  main { max-width: 640px; margin: 0 auto; padding: 16px 16px 96px;
         padding-top: calc(16px + env(safe-area-inset-top)); }
  .update {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(16px + env(safe-area-inset-bottom));
    display: flex; align-items: center; gap: 12px;
    background: var(--ink); color: var(--bg); font-size: 14px;
    padding: 10px 10px 10px 16px; border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, .25); max-width: calc(100% - 32px);
    white-space: nowrap;
  }
  .update button {
    font: inherit; font-weight: 600; color: var(--ink); background: var(--bg);
    border: none; border-radius: 8px; padding: 6px 12px; cursor: pointer;
  }
  .update .later { background: none; color: var(--bg); padding: 4px; opacity: .7; }
</style>
