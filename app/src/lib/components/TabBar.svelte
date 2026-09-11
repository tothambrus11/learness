<script lang="ts">
  /** The places you go often, in a row: at the bottom of a phone, in the title
   *  bar of anything wider. One list, positioned by CSS, so there is never a
   *  second copy to keep in step. */
  import { base } from '$app/paths';
  import { TABS } from '$lib/nav';
  import type { LucideIcon } from '@lucide/svelte';
  import BookPlus from '@lucide/svelte/icons/book-plus';
  import CalendarCheck from '@lucide/svelte/icons/calendar-check';
  import House from '@lucide/svelte/icons/house';
  import Settings from '@lucide/svelte/icons/settings';

  /** Which tab is lit. */
  interface Props {
    /** The id of the tab standing for the current page, as `nav.ts` names them
     *  (`home`, `words`, `progress`, `settings`). Empty lights none, which is
     *  what a screen outside the tabs wants. */
    current?: string;
  }

  let { current = '' }: Props = $props();

  /** The mark for each tab, keyed by the same id `TABS` uses. Every id in
   *  `TABS` has an entry. */
  const ICON: Record<string, LucideIcon> = {
    home: House,
    words: BookPlus,
    progress: CalendarCheck,
    settings: Settings,
  };
</script>

<nav class="tabs" aria-label="Main">
  {#each TABS as tab (tab.id)}
    {@const Icon = ICON[tab.id]}
    <a
      href="{base}{tab.href}"
      class:on={current === tab.id}
      aria-current={current === tab.id ? 'page' : undefined}
    >
      <Icon size={21} strokeWidth={current === tab.id ? 2.4 : 1.8} />
      <span>{tab.label}</span>
    </a>
  {/each}
</nav>

<style>
  .tabs {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: flex;
    justify-content: space-around;
    align-items: stretch;
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    backdrop-filter: saturate(180%) blur(14px);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    border-top: 1px solid var(--line);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .tabs a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 8px 4px 7px;
    color: var(--muted);
    text-decoration: none;
    font-size: 11px;
    letter-spacing: 0.01em;
    min-height: 50px;
    -webkit-tap-highlight-color: transparent;
  }
  .tabs a.on {
    color: var(--accent);
    font-weight: 600;
  }
  /* Still fixed, not moved into the bar: the bar's backdrop-filter would make
     it the containing block. `442px` is half the bar's own 900px column. */
  @media (min-width: 760px) {
    .tabs {
      left: auto;
      bottom: auto;
      top: env(safe-area-inset-top);
      right: max(8px, calc(50vw - 442px));
      height: var(--bar-row);
      /* Centred: stretched, the lit tab's pill is as tall as the whole bar. */
      align-items: center;
      border-top: none;
      background: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      padding-bottom: 0;
      gap: 2px;
      z-index: 21;
    }
    .tabs a {
      flex: 0 0 auto;
      flex-direction: row;
      gap: 7px;
      font-size: 13.5px;
      padding: 0 12px;
      height: 38px;
      border-radius: 999px;
      min-height: 0;
    }
    .tabs a.on {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
    }
  }
</style>
