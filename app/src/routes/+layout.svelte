<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { chrome, resetChrome } from '$lib/chrome.svelte';
  import AppBar from '$lib/components/AppBar.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import { display, loadDisplay } from '$lib/display.svelte';
  import { chromeFor } from '$lib/nav';
  import { applyUpdate, onUpdateReady } from '$lib/pwa';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  /** What the layout is handed: the page itself, and nothing else. Every other
   *  decision the chrome makes comes from the path or from chrome.svelte.ts. */
  interface Props {
    /** The route's own markup, rendered inside `<main>`. Always present —
     *  SvelteKit passes it for every page. */
    children: Snippet;
  }

  let { children }: Props = $props();

  /** The service worker that has a new build ready and is waiting for every
   *  old tab to close. Null until one is, which is most of the time; setting it
   *  is what puts the reload prompt on screen. */
  let waiting = $state<ServiceWorker | null>(null);

  onMount(() => {
    loadDisplay();
    return onUpdateReady((worker) => {
      waiting = worker;
    });
  });

  /** What chrome this path gets: the title, which tab is lit, where the back
   *  arrow goes, and whether there are tabs or any bar at all. Decided from the
   *  path alone, so no page draws its own header. */
  let route = $derived(chromeFor(page.url.pathname, base));
  /** Whatever a page said about itself through `chrome.svelte.ts` is dropped on
   *  the way out of its route, so the next page starts from the route alone. */
  $effect(() => {
    void route.route;
    return resetChrome;
  });

  /** The chosen gender colours, written onto the root element over the ones the
   *  theme defines, so every screen picks them up. A colour left unset removes
   *  the property rather than writing an empty one, restoring the theme's. */
  function applyGenderColours() {
    const root = document.documentElement;
    const chosen = {
      '--masc': display.colourMasc,
      '--fem': display.colourFem,
      '--plur': display.colourPlur,
    };
    for (const [name, value] of Object.entries(chosen)) {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
  }
  $effect(applyGenderColours);
</script>

<svelte:head><title>Learness</title></svelte:head>

{#if !route.bare}
  <AppBar
    title={chrome.title || route.title}
    subtitle={chrome.subtitle}
    back={route.back}
    tabs={route.tabs}
    progress={chrome.progress}
  />
{/if}
{#if route.tabs}<TabBar current={route.tab} />{/if}

<main class:tabbed={route.tabs}>{@render children()}</main>

{#if waiting}
  <div class="update" role="status" class:above-tabs={route.tabs}>
    <span>New version ready</span>
    <button onclick={() => applyUpdate(waiting)}><RefreshCw size={14} /> Reload</button>
    <button
      class="later"
      onclick={() => {
        waiting = null;
      }}
      aria-label="Later"><X size={16} /></button
    >
  </div>
{/if}

<style>
  :global(:root) {
    --bg: #eef1f1;
    --panel: #ffffff;
    --ink: #10201e;
    --muted: #5f7370;
    --line: #d8e0de;
    --accent: #0b6c62;
    --good: #0f766e;
    --bad: #b91c1c;
    --warn: #a15c07;
    --on-accent: #ffffff;
    --on-good: #ffffff;
    --on-warn: #ffffff;
    --ipa: #8a5a12;
    --fem: #c81e4a;
    --masc: #1d4ed8;
    --plur: #15803d;
    --tabs: 66px;
    /* Shared by the title bar's row and the tab row that lines up with it on a
       wide screen, where the two are separate elements. */
    --bar-row: 56px;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #000000;
      --panel: #0d1211;
      --ink: #ecf5f2;
      --muted: #8ba39e;
      --line: #1e2a28;
      --accent: #27efd7;
      --good: #27efd7;
      --bad: #ff7b7b;
      --warn: #f0b95e;
      --on-accent: #001a16;
      --on-good: #001a16;
      --on-warn: #201502;
      --ipa: #ecc178;
      --fem: #ff8fa8;
      --masc: #8ab4ff;
      --plur: #7ee787;
    }
  }
  /* Controls the browser draws itself — steppers, scrollbars, the autofill
     wash — follow this rather than the page's own colours. */
  :global(:root) {
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      color-scheme: dark;
    }
  }

  /* Drawn here rather than by the platform, whose own ignore the theme on some
     platforms and are too small to hit on a phone. */
  :global(input[type='checkbox']),
  :global(input[type='radio']) {
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    width: 22px;
    height: 22px;
    flex: 0 0 auto;
    display: inline-grid;
    place-content: center;
    /* Not --line, which is for dividing panels and too faint to read as a
       control. */
    border: 1.5px solid color-mix(in srgb, var(--muted) 55%, transparent);
    background: var(--bg);
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }
  :global(input[type='checkbox']) {
    border-radius: 6px;
  }
  :global(input[type='radio']) {
    border-radius: 50%;
  }
  :global(input[type='checkbox']:hover),
  :global(input[type='radio']:hover) {
    border-color: var(--accent);
  }
  :global(input[type='checkbox']:checked),
  :global(input[type='radio']:checked) {
    background: var(--accent);
    border-color: var(--accent);
  }
  /* The tick: two sides of a box, rotated. */
  :global(input[type='checkbox']:checked)::after {
    content: '';
    width: 6px;
    height: 11px;
    margin-top: -2px;
    border: solid var(--on-accent);
    border-width: 0 2.5px 2.5px 0;
    transform: rotate(43deg);
  }
  :global(input[type='radio']:checked)::after {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--on-accent);
  }
  :global(input[type='checkbox']:focus-visible),
  :global(input[type='radio']:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(input[type='checkbox']),
    :global(input[type='radio']) {
      transition: none;
    }
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font:
      16px/1.5 -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      sans-serif;
    overscroll-behavior-y: none;
  }
  /* Lucide icons sit on the text baseline inside buttons and labels. */
  :global(svg.lucide) {
    vertical-align: -0.18em;
    flex-shrink: 0;
  }
  :global(button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 16px 16px 32px;
  }
  main.tabbed {
    padding-bottom: calc(var(--tabs) + 24px + env(safe-area-inset-bottom));
  }
  @media (min-width: 760px) {
    main.tabbed {
      padding-bottom: 48px;
    }
  }
  .update {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    bottom: calc(16px + env(safe-area-inset-bottom));
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--ink);
    color: var(--bg);
    font-size: 14px;
    padding: 10px 10px 10px 16px;
    border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
    max-width: calc(100% - 32px);
    white-space: nowrap;
  }
  .update.above-tabs {
    bottom: calc(var(--tabs) + 16px + env(safe-area-inset-bottom));
  }
  @media (min-width: 760px) {
    .update.above-tabs {
      bottom: 16px;
    }
  }
  .update button {
    font: inherit;
    font-weight: 600;
    color: var(--ink);
    background: var(--bg);
    border: none;
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
  }
  .update .later {
    background: none;
    color: var(--bg);
    padding: 4px;
    opacity: 0.7;
  }
</style>
