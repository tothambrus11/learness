<script>
  /** The bar at the top: where you are, the way back, and how far through a
   *  sitting you are. Centred on a phone, where a title in the middle is what
   *  an app looks like; left-aligned beside the tabs on a wide screen. */
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';

  let { title = '', subtitle = '', back = '', tabs = true, progress = null } = $props();
</script>

<header class="bar" class:with-tabs={tabs}>
  <div class="row" class:with-tabs={tabs}>
    {#if back}
      <button class="back" onclick={() => goto(`${base}${back}`)} aria-label="Back">
        <ChevronLeft size={22} />
      </button>
    {/if}
    <div class="titles" class:indented={!!back}>
      <h1>{title}</h1>
      {#if subtitle}<p>{subtitle}</p>{/if}
    </div>
  </div>
  {#if progress !== null}
    <div class="line" role="progressbar" aria-valuenow={Math.round(progress * 100)}
         aria-valuemin="0" aria-valuemax="100">
      <span style="width:{Math.max(0, Math.min(1, progress)) * 100}%"></span>
    </div>
  {/if}
</header>

<style>
  .bar {
    position: sticky; top: 0; z-index: 20;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: saturate(180%) blur(14px);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    border-bottom: 1px solid var(--line);
    padding-top: env(safe-area-inset-top);
  }
  .row { display: flex; align-items: center; gap: 4px; min-height: 48px;
         max-width: 900px; margin: 0 auto; padding: 4px 8px; }
  .titles { flex: 1; text-align: center; min-width: 0; }
  /* The back arrow takes room on the left; the same room on the right keeps the
     title in the middle of the bar rather than pushed off it. */
  .titles.indented { margin-right: 34px; }
  h1 { font-size: 17px; font-weight: 650; margin: 0; letter-spacing: -.01em;
       white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  p { margin: 1px 0 0; font-size: 12px; color: var(--muted); }
  .back { display: inline-flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; border: none; background: none; color: var(--accent);
          cursor: pointer; padding: 0; border-radius: 50%; }
  .back:active { background: var(--line); }
  .line { height: 2px; background: var(--line); }
  .line span { display: block; height: 100%; background: var(--accent);
               transition: width .25s ease; }
  /* The tabs are drawn outside this bar — a backdrop-filter would pin them to
     it, and on a phone they belong at the bottom of the screen — so on a wide
     screen room is left for them on the right. */
  @media (min-width: 760px) {
    .titles, .titles.indented { text-align: left; margin-right: 0; padding-left: 6px; }
    .row.with-tabs { padding-right: 400px; }
  }
</style>
