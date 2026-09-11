<script lang="ts">
  /** Finished levels, visible; and each level's audio fetchable for offline. */
  import { level as loadLevel } from '$lib/catalogue';
  import type { LevelProgress } from '$lib/coverage';
  import { setSetting } from '$lib/db';
  import { connectionState, isOnline } from '$lib/network';
  import { cachedCount, prefetchMedia } from '$lib/prefetch';
  import { bulkDownloadDecision } from '$lib/syncpolicy';
  import type { CatalogueWord, Settings } from '$lib/types';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Download from '@lucide/svelte/icons/download';

  /** What the list is drawn from, and the one setting it may write. */
  interface Props {
    /** One row per level, in level order, as `coverageOf()` counts them.
     *  Empty draws the heading and nothing under it. */
    levels?: LevelProgress[];
    /** The settings as they stand. Only `bulkDownload` and `bulkConsent` are
     *  read, but the whole record is taken so a changed dial is never missed. */
    settings: Settings;
    /** Called after this component has written `bulkConsent`, so the screen
     *  around can read the settings again rather than go stale. */
    onSettingsChanged?: () => void;
  }

  let { levels = [], settings, onSettingsChanged = () => {} }: Props = $props();

  /** True while the list is shown. Closed by default, and opening it is what
   *  starts the cache check — there is no point counting clips nobody asked
   *  about. */
  let open = $state(false);

  /** Where one level's audio has got to: nothing said, a count while it runs,
   *  or the tick that means every clip is on the device. */
  interface LevelStatus {
    /** What to show beside the button: a progress count, a reason it cannot
     *  run, or how many clips are already there. Absent says nothing at all. */
    text?: string;
    /** True while clips are being fetched, which disables the button and shows
     *  `text` in place of its label. */
    busy?: boolean;
    /** True once every clip of the level is in the cache; the button goes away
     *  and the tick takes its place. */
    offline?: boolean;
  }

  let status = $state<Record<number, LevelStatus>>({}); /* level -> { text, busy } */

  /** Every clip file a level's words could play — the French prompt, the human
   *  recording, the English cue — with the ones that do not exist dropped. */
  const clipsOf = (words: CatalogueWord[]) =>
    words.flatMap((w) => [w.audio, w.native, w.cue_audio]);

  /** How much of one level's audio is already cached, written into `status` so
   *  the row can say "offline" rather than offer a download that would do
   *  nothing. */
  async function checkCached(n: number) {
    const words = await loadLevel(n);
    const files = clipsOf(words).filter((f): f is string => Boolean(f));
    const have = await cachedCount(files);
    status[n] =
      have >= files.length
        ? { offline: true }
        : { text: have ? `${have}/${files.length} clips` : '' };
  }

  /** Fetch a level's audio into the offline cache, asking first where the
   *  connection makes that the polite thing to do. A few megabytes, so it is
   *  never started on a guess. */
  async function download(n: number) {
    const decision = bulkDownloadDecision({
      policy: settings.bulkDownload,
      connection: connectionState(),
      online: isOnline(),
      consented: settings.bulkConsent,
    });
    if (decision.decision === 'no') {
      status[n] = { text: decision.reason };
      return;
    }
    if (decision.decision === 'ask') {
      /* Asked once, remembered on this device. */
      if (!confirm(`${decision.reason}. Download about 3 MB of audio for level ${n}?`)) return;
      await setSetting('bulkConsent', true);
      onSettingsChanged();
    }
    status[n] = { text: 'starting…', busy: true };
    const words = await loadLevel(n);
    const job = prefetchMedia(clipsOf(words), {
      concurrency: 4,
      onProgress: (done: number, total: number) => {
        status[n] = { text: `${done}/${total}`, busy: true };
      },
    });
    const res = await job.done;
    status[n] = res.failed ? { text: `${res.failed} clips failed` } : { offline: true };
  }

  /** Show or hide the list. The first time it opens, every level is asked
   *  whether its clips are already cached; the answers are kept, so opening it
   *  again is free. */
  async function toggle() {
    open = !open;
    if (open) for (const l of levels) if (!status[l.level]) checkCached(l.level);
  }
</script>

<button class="toggle" onclick={toggle} aria-expanded={open}>
  {#if open}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if} Levels
  <span class="muted"
    >{levels.filter((l) => l.known === l.total && l.total).length} finished of {levels.length}</span
  >
</button>

{#if open}
  <ul class="levels">
    {#each levels as l (l.level)}
      <li class:done={l.known === l.total && l.total > 0}>
        <span class="n">{l.level}</span>
        <span class="bar" title="{l.known} known, {l.started} started, {l.total} words">
          <span class="known" style:width="{(100 * l.known) / l.total}%"></span>
          <span class="started" style:width="{(100 * (l.started - l.known)) / l.total}%"></span>
        </span>
        <span class="count">{l.known}<span class="muted">/{l.total}</span></span>
        <span class="dl">
          {#if status[l.level]?.offline}
            <span class="muted small offline"><Check size={13} /> offline</span>
          {:else}
            <button
              class="small-btn"
              onclick={() => download(l.level)}
              disabled={status[l.level]?.busy}
            >
              {#if status[l.level]?.busy}{status[l.level].text}{:else}<Download size={13} /> audio{/if}
            </button>
            {#if status[l.level]?.text && !status[l.level]?.busy}
              <span class="muted small">{status[l.level].text}</span>
            {/if}
          {/if}
        </span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .toggle {
    display: flex;
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    color: var(--accent);
    padding: 8px 4px;
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .levels {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 2em 1fr 4.5em 7em;
    gap: 8px;
    align-items: center;
    padding: 4px 0;
    font-size: 13.5px;
  }
  li.done .n {
    color: var(--good);
    font-weight: 700;
  }
  .n {
    color: var(--muted);
    text-align: right;
  }
  .bar {
    display: flex;
    height: 8px;
    background: var(--line);
    border-radius: 4px;
    overflow: hidden;
  }
  .known {
    background: var(--good);
  }
  .started {
    background: var(--accent);
    opacity: 0.45;
  }
  .count {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .dl {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;
  }
  .small-btn {
    font: inherit;
    font-size: 12px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
  }
  .small-btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 12px;
  }
  .offline {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--good);
  }
</style>
