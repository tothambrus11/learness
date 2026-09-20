<script lang="ts">
  /** Finished levels, visible; and each level's audio fetchable for offline. */
  import { base } from '$app/paths';
  import { level as loadLevel } from '$lib/catalogue.js';
  import { levelRows } from '$lib/coverage.js';
  import { setSetting } from '$lib/db.js';
  import { report } from '$lib/diagnostics.js';
  import { detailHref } from '$lib/worddetail.js';
  import Fr from './Fr.svelte';
  import { connectionState, isOnline } from '$lib/network.js';
  import { cachedCount, prefetchMedia } from '$lib/prefetch.js';
  import { bulkDownloadDecision } from '$lib/syncpolicy.js';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Download from '@lucide/svelte/icons/download';
  import type { LevelProgress, LevelWordRow } from '$lib/coverage.js';
  import type { WordKey } from '$lib/keys.js';
  import type { Settings, StudyWord } from '$lib/model.js';

  interface Props {
    levels?: LevelProgress[];
    settings: Settings;
    /** Called after a setting is written here, so the parent re-reads it. */
    onSettingsChanged?: () => void;
    /** Where a word stands with the learner, for the words of an opened
     *  level (ladder.ts `statusOf`); nothing said where the parent has no
     *  cards to say it from. */
    statusFor?: (key: WordKey) => string;
  }

  /** What one level's row is saying: a line of progress, or that it is kept
   *  for offline. */
  interface LevelState { text?: string; busy?: boolean; offline?: boolean }

  let { levels = [], settings, onSettingsChanged = () => {}, statusFor = () => '' }: Props = $props();

  let open = $state(false);
  /* Not `state`: a variable of that name makes `$state` read as a store
     subscription, which is the legacy meaning of a $-prefixed name. */
  let levelState = $state<Record<number, LevelState>>({});
  /* The level whose words are listed, and the rows once read (#92). */
  let openLevel = $state<number | null>(null);
  let listed = $state<Record<number, LevelWordRow[]>>({});

  async function showWords(n: number): Promise<void> {
    if (openLevel === n) { openLevel = null; return; }
    openLevel = n;
    if (listed[n]) return;
    try {
      listed[n] = levelRows(await loadLevel(n), statusFor);
    } catch (err) {
      report('levels', `the words of level ${n} could not be read: ${(err as Error).message}`);
      openLevel = null;
    }
  }

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
      <li class:done={l.known === l.total && l.total > 0} class:open={openLevel === l.level}>
        <button class="n" onclick={() => showWords(l.level)} aria-expanded={openLevel === l.level}
                title="The words of level {l.level}">{l.level}</button>
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
        {#if openLevel === l.level}
          <!-- The words, in the order the sitting deals them, each with where
               it stands. A number to tap rather than a list always open: a
               level is a hundred words, and there are dozens of levels. -->
          <ul class="words">
            {#each listed[l.level] ?? [] as w (w.k)}
              <li>
                <a href={detailHref(base, w.k)}><Fr text={w.fr} /></a>
                <span class="muted">{w.en}</span>
                {#if w.status && w.status !== 'not started'}
                  <span class="status" class:known={w.status === 'known'}>{w.status}</span>
                {/if}
              </li>
            {/each}
            {#if !listed[l.level]}<li class="muted">Reading the level…</li>{/if}
          </ul>
        {/if}
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
  .n { color: var(--muted); text-align: right; border: none; background: none; font: inherit;
       padding: 0; cursor: pointer; text-decoration: underline dotted; }
  li.open .n { color: var(--accent); }
  .words { grid-column: 1 / -1; list-style: none; margin: 2px 0 6px; padding: 0 0 0 2.5em;
           display: grid; grid-template-columns: repeat(auto-fill, minmax(14em, 1fr)); gap: 2px 12px;
           font-size: 13px; }
  .words li { display: flex; gap: 6px; align-items: baseline; min-width: 0; }
  .words a { color: var(--ink); text-decoration: none; }
  .words .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .words .status { margin-left: auto; font-size: 11px; color: var(--muted); }
  .words .status.known { color: var(--good); }
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
