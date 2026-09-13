<script>
  /** The places you go often, in a row: at the bottom of a phone, in the title
   *  bar of anything wider. One list, positioned by CSS, so there is never a
   *  second copy to keep in step. */
  import { base } from '$app/paths';
  import { TABS } from '$lib/nav.js';
  import House from '@lucide/svelte/icons/house';
  import BookPlus from '@lucide/svelte/icons/book-plus';
  import CalendarCheck from '@lucide/svelte/icons/calendar-check';
  import Settings from '@lucide/svelte/icons/settings';

  let { current = '' } = $props();

  const ICON = { home: House, words: BookPlus, progress: CalendarCheck, settings: Settings };
</script>

<nav class="tabs" aria-label="Main">
  {#each TABS as tab (tab.id)}
    {@const Icon = ICON[tab.id]}
    <a href="{base}{tab.href}" class:on={current === tab.id}
       aria-current={current === tab.id ? 'page' : undefined}>
      <Icon size={21} strokeWidth={current === tab.id ? 2.4 : 1.8} />
      <span data-label={tab.label}>{tab.label}</span>
    </a>
  {/each}
</nav>

<style>
  .tabs {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
    display: flex; justify-content: space-around; align-items: stretch;
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    backdrop-filter: saturate(180%) blur(14px);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    border-top: 1px solid var(--line);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .tabs a {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; padding: 8px 4px 7px; color: var(--muted); text-decoration: none;
    font-size: 11px; letter-spacing: .01em; min-height: 50px;
    -webkit-tap-highlight-color: transparent;
  }
  .tabs a.on { color: var(--accent); font-weight: 600; }
  /* The lit tab is bolder, and bold is wider. In the title bar, where the row
     is laid out from its labels, that made every tab shift along as you tapped
     between them. So each label is always given the width of its own bold
     self — drawn underneath at zero height — and the weight then changes
     inside a box that does not move. */
  .tabs a span { display: inline-block; white-space: nowrap; }
  .tabs a span::after {
    content: attr(data-label); display: block; height: 0; overflow: hidden;
    visibility: hidden; font-weight: 600;
  }
  /* Wide enough for a title bar to hold them: the row moves up beside the
     title, rather than hanging off the bottom of a monitor. It stays fixed
     rather than moving into the bar, because the bar's backdrop-filter would
     make it the containing block and the row would be stuck to it on a phone
     too. Kept in line with the bar's own 900px column. */
  @media (min-width: 760px) {
    .tabs {
      left: auto; bottom: auto; top: env(safe-area-inset-top);
      right: max(8px, calc(50vw - 442px)); height: var(--bar-row);
      /* Centred, not stretched: a stretched link makes the lit tab's pill as
         tall as the whole bar, edge to edge. */
      align-items: center;
      border-top: none; background: none; backdrop-filter: none;
      -webkit-backdrop-filter: none; padding-bottom: 0; gap: 2px; z-index: 21;
    }
    .tabs a { flex: 0 0 auto; flex-direction: row; gap: 7px; font-size: 13.5px;
              padding: 0 12px; height: 38px; border-radius: 999px; min-height: 0; }
    .tabs a.on { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  }
</style>
