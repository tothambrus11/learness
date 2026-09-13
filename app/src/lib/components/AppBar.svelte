<script lang="ts">
  /** The bar at the top: whose app this is, where you are, the way back, and
   *  how far through a sitting you are.
   *
   *  Two shapes, the way a phone app has two. A place you can reach from the
   *  tabs is branded and reads from the left — the mark, then the page name
   *  beside it. A screen you were pushed into gives that slot to the back arrow
   *  and centres its title, which is what tells you at a glance that you are
   *  somewhere you came from rather than somewhere you are.
   */
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import Logo from './Logo.svelte';
  import Bug from '@lucide/svelte/icons/bug';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';

  /** Straight to a new issue on the repository. In the bar rather than buried
   *  in settings, because the moment you want to report something is the moment
   *  you are looking at it. */
  const REPORT = 'https://github.com/tothambrus11/learness/issues/new';

  interface Props {
    title?: string;
    subtitle?: string;
    /** Where the back arrow goes; empty means the mark instead. */
    back?: string;
    /** Whether the tab row shares this bar on a wide screen. */
    tabs?: boolean;
    /** 0..1 through a sitting, or null for no line. */
    progress?: number | null;
  }

  let { title = '', subtitle = '', back = '', tabs = true, progress = null }: Props = $props();
</script>

<header class="bar">
  <div class="row" class:with-tabs={tabs}>
    {#if back}
      <button class="back" onclick={() => goto(`${base}${back}`)} aria-label="Back">
        <ChevronLeft size={22} />
      </button>
    {:else}
      <a class="mark" href="{base}/" aria-label="Learness home"><Logo size={25} /></a>
    {/if}
    <div class="titles" class:centred={!!back}>
      <h1>{title}</h1>
      {#if subtitle}<p>{subtitle}</p>{/if}
    </div>
    <a class="report" href={REPORT} target="_blank" rel="noopener noreferrer"
       title="Report a problem" aria-label="Report a problem">
      <Bug size={19} />
    </a>
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
  .row { display: flex; align-items: center; gap: 10px; box-sizing: border-box;
         height: var(--bar-row); max-width: 900px; margin: 0 auto; padding: 0 14px; }
  .titles { flex: 1; min-width: 0; }
  /* Pushed screen: the arrow takes the left, and the bug button on the right is
     the same width, so the title sits in the middle of the bar. */
  .titles.centred { text-align: center; }
  h1 { font-size: 17px; font-weight: 650; margin: 0; letter-spacing: -.01em;
       white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  p { margin: 1px 0 0; font-size: 12px; color: var(--muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mark { display: flex; align-items: center; flex: 0 0 auto; padding: 4px 0;
          -webkit-tap-highlight-color: transparent; }
  .back { display: inline-flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; margin-left: -8px; border: none; background: none;
          color: var(--accent); cursor: pointer; padding: 0; border-radius: 50%; }
  .back:active { background: var(--line); }
  .report { display: inline-flex; align-items: center; justify-content: center;
            width: 34px; height: 34px; margin-right: -6px; flex: 0 0 auto;
            color: var(--muted); border-radius: 50%;
            -webkit-tap-highlight-color: transparent; }
  .report:active { background: var(--line); }
  .report:hover { color: var(--ink); }
  .mark:focus-visible, .back:focus-visible, .report:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  .line { height: 2px; background: var(--line); }
  .line span { display: block; height: 100%; background: var(--accent);
               transition: width .25s ease; }
  @media (prefers-reduced-motion: reduce) { .line span { transition: none; } }
  /* The tabs are drawn outside this bar — a backdrop-filter would pin them to
     it, and on a phone they belong at the bottom of the screen — so on a wide
     screen room is left for them on the right. */
  @media (min-width: 760px) {
    .titles.centred { text-align: left; }
    /* Room for the tabs, which are drawn over this bar rather than in it. The
       reserve goes on the row, not the title: everything in the row sits after
       the title, so a reserve there leaves the last of them — the bug — under
       the tabs. Both are anchored to the same 900px column, so one number holds
       at every width. */
    .row.with-tabs { padding-right: 416px; }
  }
</style>
