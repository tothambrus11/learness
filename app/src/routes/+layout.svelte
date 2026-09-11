<script>
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { applyUpdate, onUpdateReady } from '$lib/pwa.js';
  import { chromeFor } from '$lib/nav.js';
  import { chrome, resetChrome } from '$lib/chrome.svelte.js';
  import { display, loadDisplay } from '$lib/display.svelte.js';
  import AppBar from '$lib/components/AppBar.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import X from '@lucide/svelte/icons/x';

  let { children } = $props();
  let waiting = $state(null);

  onMount(() => {
    loadDisplay();
    return onUpdateReady((worker) => { waiting = worker; });
  });

  let route = $derived(chromeFor(page.url.pathname, base));
  /* A page speaks for itself through chrome.svelte.js; whatever it does not say
     comes from the route. Cleared on the way out, so nothing is left behind. */
  $effect(() => {
    route.route;
    return resetChrome;
  });
  /* Your own colours go on the root, over the variables the themes define, so
     every screen and every component picks them up without knowing they were
     changed. Cleared back to the theme's own when you clear the setting. */
  $effect(() => {
    const root = document.documentElement;
    const chosen = { '--masc': display.colourMasc, '--fem': display.colourFem,
      '--plur': display.colourPlur };
    for (const [name, value] of Object.entries(chosen)) {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
  });
</script>

<svelte:head><title>Learness</title></svelte:head>

{#if !route.bare}
  <AppBar title={chrome.title || route.title} subtitle={chrome.subtitle}
          back={route.back} tabs={route.tabs} progress={chrome.progress} />
{/if}
{#if route.tabs}<TabBar current={route.tab} />{/if}

<main class:tabbed={route.tabs}>{@render children()}</main>

{#if waiting}
  <div class="update" role="status" class:above-tabs={route.tabs}>
    <span>New version ready</span>
    <button onclick={() => applyUpdate(waiting)}><RefreshCw size={14} /> Reload</button>
    <button class="later" onclick={() => { waiting = null; }} aria-label="Later"><X size={16} /></button>
  </div>
{/if}

<style>
  :global(:root) {
    /* Midnight: the logo's turquoise, which is a dark-mode colour — 1.4:1 on
       white — so light mode carries the same hue deepened until it can be read
       and dark mode gets the brand itself, at full strength, on black.
       Everything else is derived from those two. */
    --bg: #eef1f1; --panel: #ffffff; --ink: #10201e; --muted: #5f7370;
    --line: #d8e0de; --accent: #0b6c62; --good: #0f766e; --bad: #b91c1c;
    --warn: #a15c07;
    /* What can be read *on* a filled accent, good or warning. A token rather
       than white, because in dark mode those fills are bright and want near-
       black on them; white would be unreadable. */
    --on-accent: #ffffff; --on-good: #ffffff; --on-warn: #ffffff;
    --ipa: #8a5a12;
    /* Gender, wherever a noun is shown: feminine, masculine, plural. Plural
       leaves green for violet — green beside a teal accent reads as the accent.
       The settings page can replace any of the three. */
    --fem: #c81e4a; --masc: #1d4ed8; --plur: #6d28d9;
    --tabs: 66px;
    /* The height of the title bar's content row. The tabs sit in the same row
       on a wide screen, and are a separate element there, so the two must agree
       on one number or they do not line up. */
    --bar-row: 56px;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #000000; --panel: #0d1211; --ink: #ecf5f2; --muted: #8ba39e;
      --line: #1e2a28; --accent: #27efd7; --good: #27efd7; --bad: #ff7b7b;
      --warn: #f0b95e;
      --on-accent: #001a16; --on-good: #001a16; --on-warn: #201502;
      --ipa: #ecc178;
      --fem: #ff8fa8; --masc: #8ab4ff; --plur: #d0bcff;
    }
  }
  :global(body) {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    /* A phone app does not rubber-band its whole page under a fixed tab bar. */
    overscroll-behavior-y: none;
  }
  /* Lucide icons sit on the text baseline inside buttons and labels. */
  :global(svg.lucide) { vertical-align: -0.18em; flex-shrink: 0; }
  :global(button) { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  main { max-width: 640px; margin: 0 auto; padding: 16px 16px 32px; }
  /* Room for the tab bar, plus whatever the phone's home indicator takes. */
  main.tabbed { padding-bottom: calc(var(--tabs) + 24px + env(safe-area-inset-bottom)); }
  @media (min-width: 760px) { main.tabbed { padding-bottom: 48px; } }
  .update {
    position: fixed; left: 50%; transform: translateX(-50%); z-index: 30;
    bottom: calc(16px + env(safe-area-inset-bottom));
    display: flex; align-items: center; gap: 12px;
    background: var(--ink); color: var(--bg); font-size: 14px;
    padding: 10px 10px 10px 16px; border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, .25); max-width: calc(100% - 32px);
    white-space: nowrap;
  }
  .update.above-tabs { bottom: calc(var(--tabs) + 16px + env(safe-area-inset-bottom)); }
  @media (min-width: 760px) { .update.above-tabs { bottom: 16px; } }
  .update button {
    font: inherit; font-weight: 600; color: var(--ink); background: var(--bg);
    border: none; border-radius: 8px; padding: 6px 12px; cursor: pointer;
  }
  .update .later { background: none; color: var(--bg); padding: 4px; opacity: .7; }
</style>
