<script lang="ts">
  /** The audio for words you added yourself, wherever they are shown.
   *
   *  A view over the backlog (voicestate.svelte.ts): what it is making, what
   *  it still owes, and why it is not making it — the voice not on the device,
   *  the setting saying "when a card asks", the cache full. Under one word on
   *  a row, a card or its page; over the whole list on the words screen. What
   *  is said is `voicePanel`'s decision (voicepanel.ts), tested as a table;
   *  this draws one shape per kind.
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
  import { report } from '$lib/diagnostics.js';
  import { ENGINE_LABEL, MODEL_MB, WORD_SLOT, cancel, fetchVoice, onStatus } from '$lib/tts.js';
  import { voiceDecision } from '$lib/voice.js';
  import { voicePanel } from '$lib/voicepanel.js';
  import type { PanelAction } from '$lib/voicepanel.js';
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
  /** The cap, for the sentence about a full cache; null until read, and
   *  where it could not be. Read again each time the cache fills. */
  let capMb = $state<number | null>(null);

  onMount(() => onStatus((st) => { voice = st; }));
  $effect(() => {
    if (backlog.why !== 'cache full') return;
    getSettings().then((s) => { capMb = s.clipCacheMb; }).catch((err: unknown) => {
      capMb = null;
      report('voice', `the clip cache cap could not be read: ${(err as Error).message}`);
    });
  });

  let panel = $derived(voicePanel({
    backlog, voice, word, summary, fetching, asking: !!asking,
    making: !!word && isMaking(word.k, WORD_SLOT), capMb,
  }));

  /** The press: make now if the voice is here, ask about the download if
   *  not. On one word, that word — under ahead-of-time it is simply next. */
  async function start(): Promise<void> {
    error = '';
    const d = await voiceDecision();
    if ('no' in d) { error = d.reason; return; }
    if ('ask' in d) { asking = d; return; }
    run();
  }
  function run(): void {
    if (word) {
      preferWord(word.k);
      runBacklogNow({ only: word.k, retryFailed: true });
    } else {
      runBacklogNow({ retryFailed: true });
    }
  }

  /** The download agreed to. Once the voice is here the backlog starts by
   *  itself where the setting allows — with this word first — and is given
   *  the press's run here where it does not. */
  async function agree(): Promise<void> {
    asking = null;
    error = '';
    stopped = false;
    fetching = true;
    if (word) preferWord(word.k);
    try {
      await fetchVoice();
      if ((await getSettings()).eagerVoice === false) run();
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

  function act(action: PanelAction): void {
    if (action === 'make' || action === 'try') void start();
    else if (action === 'next' && word) preferWord(word.k);
    else if (action === 'cancel-run') stopBacklogRun();
    else stopDownload();
  }

  const sentence = (text: string): string =>
    (text ? text[0]!.toUpperCase() + text.slice(1) : '');
</script>

{#if panel || error}
  <div class="voice" class:compact class:summary>
    {#if panel?.kind === 'ask' && asking}
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
    {:else if panel}
      <div class="run">
        <span class="what" class:warn={panel.warn}>
          {#if panel.spinner}<Spinner label={panel.text} />{:else if panel.warn}<TriangleAlert size={14} />{/if}
          {panel.text}{#if panel.emphasis} for <b>{panel.emphasis}</b>{/if}{#if panel.kind === 'run'}…{/if}
          {#if panel.count}<b>{panel.count}</b>{/if}
        </span>
        {#if panel.action === 'cancel-run' || panel.action === 'cancel-download'}
          <button class="stop" onclick={() => act(panel.action!)}><X size={15} /> {panel.actionLabel}</button>
        {:else if panel.action === 'next'}
          <button class="link" onclick={() => act('next')}>{panel.actionLabel}</button>
        {:else if panel.action}
          <button onclick={() => act(panel.action!)}><AudioWaveform size={15} /> {panel.actionLabel}</button>
        {/if}
      </div>
      {#if panel.progress !== null}
        <progress value={panel.progress} max="1"></progress>
      {/if}
      {#if panel.failed && panel.kind !== 'failed'}
        <p class="what warn">
          <TriangleAlert size={14} /> {panel.failed}
          <button class="link" onclick={() => act('try')}>Try again</button>
        </p>
      {/if}
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
  p.what { margin: 6px 0 0; }
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
