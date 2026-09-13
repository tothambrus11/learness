<script lang="ts">
  /** Finished levels, visible; and each level's audio fetchable for offline. */
  import { level as loadLevel } from '$lib/catalogue.js';
  import { setSetting } from '$lib/db.js';
  import { connectionState, isOnline } from '$lib/network.js';
  import { cachedCount, prefetchMedia } from '$lib/prefetch.js';
  import { bulkDownloadDecision } from '$lib/syncpolicy.js';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Download from '@lucide/svelte/icons/download';
  import type { LevelProgress } from '$lib/coverage.js';
  import type { Settings, StudyWord } from '$lib/model.js';

  interface Props {
    levels?: LevelProgress[];
    settings: Settings;
    /** Called after a setting is written here, so the parent re-reads it. */
    onSettingsChanged?: () => void;
  }

  /** What one level's row is saying: a line of progress, or that it is kept
   *  for offline. */
  interface LevelState { text?: string; busy?: boolean; offline?: boolean }

  let { levels = [], settings, onSettingsChanged = () => {} }: Props = $props();

  let open = $state(false);
  /* Not `state`: a variable of that name makes `$state` read as a store
     subscription, which is the legacy meaning of a $-prefixed name. */
  let levelState = $state<Record<number, LevelState>>({});

  const clipsOf = (words: StudyWord[]): (string | null | undefined)[] =>
    words.flatMap((w) => [w.audio, w.native, w.cue_audio]);

  async function checkCached(n: number): Promise<void> {
    const words = await loadLevel(n);
    const files = clipsOf(words).filter(Boolean);
    const have = await cachedCount(files);
    levelState[n] = have >= files.length ? { offline: true }
      : { text: have ? `${have}/${files.length} clips` : '' };
  }

  async function download(n: number): Promise<void> {
    const decision = bulkDownloadDecision({
      policy: settings.bulkDownload, connection: connectionState(), online: isOnline(),
      consented: settings.bulkConsent,
    });
    if (decision.decision === 'no') { levelState[n] = { text: decision.reason }; return; }
    if (decision.decision === 'ask') {
      /* Asked once, remembered on this device. */
      if (!confirm(`${decision.reason}. Download about 3 MB of audio for level ${n}?`)) return;
      await setSetting('bulkConsent', true);
      onSettingsChanged();
    }
    levelState[n] = { text: 'starting…', busy: true };
    const words = await loadLevel(n);
    const job = prefetchMedia(clipsOf(words), {
      concurrency: 4,
      onProgress: (done, total): void => {
        levelState[n] = { text: `${done}/${total}`, busy: true };
      },
    });
    const res = await job.done;
    levelState[n] = res.failed ? { text: `${res.failed} clips failed` } : { offline: true };
  }

  async function toggle(): Promise<void> {
    open = !open;
    if (open) for (const l of levels) if (!levelState[l.level]) void checkCached(l.level);
  }
</script>

<button class="toggle" onclick={toggle} aria-expanded={open}>
  {#if open}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if} Levels
  <span class="muted">{levels.filter((l) => l.known === l.total && l.total).length} finished of {levels.length}</span>
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
          {#if levelState[l.level]?.offline}
            <span class="muted small offline"><Check size={13} /> offline</span>
          {:else}
            <button class="small-btn" onclick={() => download(l.level)}
                    disabled={levelState[l.level]?.busy}>
              {#if levelState[l.level]?.busy}{levelState[l.level]?.text}{:else}<Download size={13} /> audio{/if}
            </button>
            {#if levelState[l.level]?.text && !levelState[l.level]?.busy}
              <span class="muted small">{levelState[l.level]?.text}</span>
            {/if}
          {/if}
        </span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .toggle { display: flex; justify-content: flex-start; gap: 8px; width: 100%; text-align: left; border: none;
            background: none; color: var(--accent); padding: 8px 4px; font: inherit;
            font-size: 14px; cursor: pointer; }
  .levels { list-style: none; margin: 0 0 12px; padding: 0; }
  li { display: grid; grid-template-columns: 2em 1fr 4.5em 7em; gap: 8px; align-items: center;
       padding: 4px 0; font-size: 13.5px; }
  li.done .n { color: var(--good); font-weight: 700; }
  .n { color: var(--muted); text-align: right; }
  .bar { display: flex; height: 8px; background: var(--line); border-radius: 4px;
         overflow: hidden; }
  .known { background: var(--good); }
  .started { background: var(--accent); opacity: .45; }
  .count { text-align: right; font-variant-numeric: tabular-nums; }
  .dl { display: flex; gap: 6px; align-items: center; justify-content: flex-end; }
  /* A dense row, so a size down from the rest of the app. */
  .small-btn { font-size: 12px; padding: 3px 9px; }
  .small { font-size: 12px; }
  .offline { display: inline-flex; align-items: center; gap: 3px; color: var(--good); }
</style>
