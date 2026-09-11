<script lang="ts">
  /** The bar at the top: whose app this is, where you are, the way back, and
   *  how far through a sitting you are. */
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import Bug from '@lucide/svelte/icons/bug';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';

  import Logo from './Logo.svelte';

  /** Straight to a new issue on the repository. */
  const REPORT = 'https://github.com/tothambrus11/learness/issues/new';

  /** Everything the bar is told about the screen under it. */
  interface Props {
    /** What the bar says. Empty draws an empty title rather than falling back
     *  to anything. */
    title?: string;
    /** The second line, for a page with something to add. Empty draws no line
     *  at all, so the row keeps its height. */
    subtitle?: string;
    /** Where the back arrow goes, as a path without the base: `'/'`. Empty
     *  means this is a place you reached from the tabs, so the mark takes that
     *  slot instead and the title is not centred. */
    back?: string;
    /** True where the tab row is drawn over this bar on a wide screen, so room
     *  is reserved for it on the right. False in a flow that has the screen to
     *  itself. */
    tabs?: boolean;
    /** How far through a sitting, 0..1, drawn as a hairline under the row;
     *  null where the screen has nothing to count. Values outside 0..1 are
     *  clamped rather than rejected. */
    progress?: number | null;
  }

  let { title = '', subtitle = '', back = '', tabs = true, progress = null }: Props = $props();

  /** How much of the hairline is filled, as a percentage, with values outside
   *  0..1 clamped to the ends. */
  let filled = $derived(Math.max(0, Math.min(1, progress ?? 0)) * 100);
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
    <a
      class="report"
      href={REPORT}
      target="_blank"
      rel="noopener noreferrer"
      title="Report a problem"
      aria-label="Report a problem"
    >
      <Bug size={19} />
    </a>
  </div>
  {#if progress !== null}
    <div
      class="line"
      role="progressbar"
      aria-valuenow={Math.round(progress * 100)}
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span style="width:{filled}%"></span>
    </div>
  {/if}
</header>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 20;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: saturate(180%) blur(14px);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    border-bottom: 1px solid var(--line);
    padding-top: env(safe-area-inset-top);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    box-sizing: border-box;
    height: var(--bar-row);
    max-width: 900px;
    margin: 0 auto;
    padding: 0 14px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  /* Centres because `.back` and `.report` are the same 34px wide. */
  .titles.centred {
    text-align: center;
  }
  h1 {
    font-size: 17px;
    font-weight: 650;
    margin: 0;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  p {
    margin: 1px 0 0;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mark {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    padding: 4px 0;
    -webkit-tap-highlight-color: transparent;
  }
  .back {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    margin-left: -8px;
    border: none;
    background: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    border-radius: 50%;
  }
  .back:active {
    background: var(--line);
  }
  .report {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    margin-right: -6px;
    flex: 0 0 auto;
    color: var(--muted);
    border-radius: 50%;
    -webkit-tap-highlight-color: transparent;
  }
  .report:active {
    background: var(--line);
  }
  .report:hover {
    color: var(--ink);
  }
  .mark:focus-visible,
  .back:focus-visible,
  .report:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .line {
    height: 2px;
    background: var(--line);
  }
  .line span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.25s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .line span {
      transition: none;
    }
  }
  @media (min-width: 760px) {
    .titles.centred {
      text-align: left;
    }
    /* Room on the row — not the title — for the tab row drawn over this bar:
       anything after the title would otherwise sit under the tabs. */
    .row.with-tabs {
      padding-right: 416px;
    }
  }
</style>
