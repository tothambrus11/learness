<script lang="ts">
  /** The audio for words you added yourself, wherever they are shown.
   *
   *  A view over the backlog (voicestate.svelte.ts): what it is making, what
   *  it still owes, and why it is not making it — the voice not on the device,
   *  the setting saying "when a card asks", the cache full. Under one word on
   *  a row, a card or its page; over the whole list on the words screen.
   *
   *  Two things are decided here and nowhere else: whether the 380 MB voice
   *  may be fetched — never on a guess, the size in the sentence and on the
   *  button — and cancelling that download. Nothing here makes a clip: a
   *  press hands the backlog a run, or moves this word to the front of one.
   *  It used to loop the words itself, beside the queue every other clip
   *  goes through, and its Cancel terminated the voice for everyone.
   */
  import { onMount } from 'svelte';
  import { getSettings } from '$lib/db.js';
  import { ENGINE_LABEL, MODEL_MB, WORD_SLOT, cancel, fetchVoice, onStatus } from '$lib/tts.js';
  import { voiceDecision } from '$lib/voice.js';
  import type { VoiceAsk } from '$lib/voice.js';
  import type { VoiceStatus } from '$lib/tts.js';
  import type { UserWord } from '$lib/model.js';
  import { backlog, isMaking, preferWord, runBacklogNow, stopBacklogRun }
    from '$lib/voicestate.svelte.js';
  import Spinner from './Spinner.svelte';
  import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    /** The one word this stands for — on its row, its card, its page — or
     *  none for the panel that stands for the whole list. */
    word?: Pick<UserWord, 'k' | 'fr'> | null;
    compact?: boolean;
    /** The panel over the list: it stays out of the way while there is only
     *  one word to do, since that word's own row already says so, and comes
     *  forward while a run is on or something went wrong. */
    summary?: boolean;
  }

  let { word = null, compact = false, summary = false }: Props = $props();

  let asking = $state<VoiceAsk | null>(null);
  let error = $state('');
  /** The download was started from here, so here is where it is watched. */
  let fetching = $state(false);
  let stopped = false;               /* cancelled here: not a failure to report */
  let voice = $state<VoiceStatus>({ phase: 'idle', text: '', progress: 0 });
  let capMb = $state(0);

  onMount(() => onStatus((st) => { voice = st; }));
  /* The cap is read only to be printed in the sentence about a full cache. */
  $effect(() => {
    if (backlog.why === 'cache full' && !capMb) {
      getSettings().then((s) => { capMb = s.clipCacheMb; }).catch(() => {});
    }
  });

  /* This word, or the whole list. */
  let owed = $derived(word ? backlog.pending[word.k] ?? null : null);
  let makingThis = $derived(!!word && isMaking(word.k, WORD_SLOT));
  let failedThis = $derived(!!word && backlog.failed.includes(word.k));
  let count = $derived(Object.keys(backlog.pending).length);
  let stale = $derived(Object.values(backlog.pending).filter((s) => s === 'stale').length);
  let held = $derived(backlog.why === 'on demand' || backlog.why === 'no voice');
  let loading = $derived(voice.phase === 'loading');

  let what = $derived(word
    ? (owed === 'stale' ? 'Audio is out of date' : 'No audio yet')
    : `${count} words ${stale === count ? 'with out-of-date audio' : 'without audio'}`);
  let action = $derived((word ? owed === 'stale' : stale === count) ? 'Make it again' : 'Make audio');

  let shown = $derived(summary
    ? backlog.running || loading || asking || error || backlog.failed.length || (count > 1 && backlog.why)
    : makingThis || owed || failedThis || asking || (fetching && loading) || error);

  /** Make the owed words: now if the voice is here, after asking if not. */
  async function start(): Promise<void> {
    error = '';
    const d = await voiceDecision();
    if ('no' in d) { error = d.reason; return; }
    if ('ask' in d) { asking = d; return; }
    if (word) preferWord(word.k);
    runBacklogNow({ retryFailed: true });
  }

  /** The download agreed to. Once the voice is here the backlog starts by
   *  itself where the setting allows, and is given one run here where it
   *  does not. */
  async function agree(): Promise<void> {
    asking = null;
    error = '';
    stopped = false;
    fetching = true;
    try {
      await fetchVoice();
      if ((await getSettings()).eagerVoice === false) runBacklogNow({ retryFailed: true });
    } catch (err) {
      if (!stopped) error = (err as Error).message;
    } finally {
      fetching = false;
    }
  }

  /** Only ever the download: a clip being made belongs to the queue, and the
   *  queue is never terminated from a screen. */
  function stopDownload(): void {
    stopped = true;
    cancel();
    asking = null;
  }

  const sentence = (text: string): string =>
    (text ? text[0]!.toUpperCase() + text.slice(1) : '');
</script>

{#if shown}
  <div class="voice" class:compact class:summary>
    {#if fetching && loading}
      <div class="run">
        <span class="what"><Spinner label="preparing the voice" /> {voice.text || 'preparing the voice'}…</span>
        <button class="stop" onclick={stopDownload}><X size={15} /> Cancel</button>
      </div>
      <progress value={voice.progress || 0} max="1"></progress>
    {:else if asking}
      <!-- The size is in the sentence and on the button: this is the one
           download in the app big enough to matter on someone's data plan, and
           it is never started on a guess about the connection. -->
      <p class="ask" class:urgent={asking.urgent}>
        {#if asking.urgent}<TriangleAlert size={15} />{/if}
        Making audio here needs the voice itself — a one-time
        <b>{asking.cost} MB</b> download. {sentence(asking.reason)}.
      </p>
      <div class="row">
        <button class="primary" onclick={() => (asking = null)}>Not now</button>
        <button class:warn={asking.urgent} onclick={agree}>Download {asking.cost} MB</button>
      </div>
    {:else if word}
      {#if makingThis}
        <div class="run">
          <span class="what"><Spinner label="making audio" /> Making audio…</span>
        </div>
      {:else if owed && backlog.why === 'cache full'}
        <p class="what warn">
          <TriangleAlert size={14} /> {what} — the audio cache is full at {capMb} MB; raise the cap in Settings.
        </p>
      {:else if owed && loading}
        <div class="run"><span class="what"><Spinner label="preparing the voice" /> Preparing the voice…</span></div>
      {:else if owed && held}
        <div class="run">
          <span class="what" class:warn={owed === 'stale'}>
            {#if owed === 'stale'}<TriangleAlert size={14} />{/if}{what}
          </span>
          <button onclick={start}><AudioWaveform size={15} /> {action}</button>
        </div>
      {:else if owed}
        <div class="run">
          <span class="what" class:warn={owed === 'stale'}>
            {#if owed === 'stale'}<TriangleAlert size={14} />{/if}{what} · waiting its turn
          </span>
          <button class="link" onclick={() => preferWord(word.k)}>Make it next</button>
        </div>
      {:else if failedThis}
        <div class="run">
          <span class="what warn"><TriangleAlert size={14} /> The voice could not make this word.</span>
          <button onclick={start}><AudioWaveform size={15} /> Try again</button>
        </div>
      {/if}
    {:else if backlog.running}
      <div class="run">
        <span class="what">
          <Spinner label="making audio" />
          Making audio{#if backlog.current} for <b>{backlog.current.text}</b>{/if}…
          {#if backlog.total > 1}<b>{Math.min(backlog.done + 1, backlog.total)} of {backlog.total}</b>{/if}
        </span>
        {#if backlog.manual}
          <button class="stop" onclick={stopBacklogRun}><X size={15} /> Cancel</button>
        {/if}
      </div>
    {:else if count && loading}
      <div class="run"><span class="what"><Spinner label="preparing the voice" /> Preparing the voice…</span></div>
    {:else if count && held}
      <div class="run">
        <span class="what" class:warn={stale > 0}>
          {#if stale}<TriangleAlert size={14} />{/if}{what}
        </span>
        <button onclick={start}><AudioWaveform size={15} /> {action}</button>
      </div>
    {:else if count && backlog.why === 'cache full'}
      <p class="what warn">
        <TriangleAlert size={14} /> {count} {count === 1 ? 'word is' : 'words are'} waiting: the audio cache
        is full at {capMb} MB. Raise the cap in Settings, or let a card ask for each.
      </p>
    {/if}
    {#if !word && backlog.failed.length}
      <p class="what warn">
        <TriangleAlert size={14} /> {backlog.failed.length} could not be made — see What went wrong in Settings.
        <button class="link" onclick={start}>Try again</button>
      </p>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
    {#if summary}
      <!-- What the voice is, said where the work is offered rather than in a
           panel of its own that would outlive it. -->
      <p class="note">
        Your own words are spoken here, on this device, in {ENGINE_LABEL}'s French and
        English voices; the voice itself is a one-time {MODEL_MB} MB download.
      </p>
    {/if}
  </div>
{/if}

<style>
  .voice { width: 100%; font-size: 13px; }
  .voice.summary { background: var(--panel); border: 1px solid var(--line);
                   border-radius: 14px; padding: 14px; margin-bottom: 12px;
                   box-sizing: border-box; }
  .note { color: var(--muted); margin: 8px 0 0; }
  .run { display: flex; align-items: center; justify-content: space-between; gap: 10px;
         flex-wrap: wrap; }
  .compact .run { justify-content: flex-end; }
  .what { display: inline-flex; align-items: center; gap: 5px; color: var(--muted);
          flex-wrap: wrap; }
  p.what { margin: 0; }
  .what.warn { color: var(--warn); }
  .ask { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
         margin: 0 0 8px; color: var(--ink); }
  .ask.urgent { color: var(--warn); }
  button.warn { border-color: var(--warn); color: var(--warn); }
  .row { display: flex; gap: 8px; }
  button { font-size: 13px; padding: 7px 12px; border-radius: 999px; }
  button.link { padding: 0; }
  button.stop { color: var(--bad); }
  progress { width: 100%; margin-top: 6px; accent-color: var(--accent); height: 6px; }
  .error { margin: 6px 0 0; }
</style>
