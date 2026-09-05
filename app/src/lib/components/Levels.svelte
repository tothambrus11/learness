<script>
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

  let { levels = [], settings, onSettingsChanged = () => {} } = $props();

  let open = $state(false);
  let state = $state({});      /* level -> { text, busy } */

  const clipsOf = (words) => words.flatMap((w) => [w.audio, w.native, w.cue_audio]);

  async function checkCached(n) {
    const words = await loadLevel(n);
    const files = clipsOf(words).filter(Boolean);
    const have = await cachedCount(files);
    state[n] = have >= files.length ? { offline: true }
      : { text: have ? `${have}/${files.length} clips` : '' };
  }

  async function download(n) {
    const decision = bulkDownloadDecision({
      policy: settings.bulkDownload, connection: connectionState(), online: isOnline(),
      consented: settings.bulkConsent,
    });
    if (decision.decision === 'no') { state[n] = { text: decision.reason }; return; }
    if (decision.decision === 'ask') {
      /* Asked once, remembered on this device. */
      if (!confirm(`${decision.reason}. Download about 3 MB of audio for level ${n}?`)) return;
      await setSetting('bulkConsent', true);
      onSettingsChanged();
    }
    state[n] = { text: 'starting…', busy: true };
    const words = await loadLevel(n);
    const job = prefetchMedia(clipsOf(words), {
      concurrency: 4,
      onProgress: (done, total) => { state[n] = { text: `${done}/${total}`, busy: true }; },
    });
    const res = await job.done;
    state[n] = res.failed ? { text: `${res.failed} clips failed` } : { offline: true };
  }

  async function toggle() {
    open = !open;
    if (open) for (const l of levels) if (!state[l.level]) checkCached(l.level);
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
          {#if state[l.level]?.offline}
            <span class="muted small offline"><Check size={13} /> offline</span>
          {:else}
            <button class="small-btn" onclick={() => download(l.level)}
                    disabled={state[l.level]?.busy}>
              {#if state[l.level]?.busy}{state[l.level].text}{:else}<Download size={13} /> audio{/if}
            </button>
            {#if state[l.level]?.text && !state[l.level]?.busy}
              <span class="muted small">{state[l.level].text}</span>
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
  .small-btn { font: inherit; font-size: 12px; padding: 3px 9px; border-radius: 999px;
               border: 1px solid var(--line); background: var(--panel); color: var(--ink);
               cursor: pointer; }
  .small-btn:disabled { opacity: .6; cursor: progress; }
  .muted { color: var(--muted); }
  .small { font-size: 12px; }
  .offline { display: inline-flex; align-items: center; gap: 3px; color: var(--good); }
</style>
