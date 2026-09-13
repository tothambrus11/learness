<script lang="ts">
  /** The audio for words you added yourself, wherever they are shown.
   *
   *  Says what is wrong — no clips yet, or clips left over from before the word
   *  was corrected — and makes them here rather than sending you to another
   *  screen. The first time, that means fetching the voice, so this is also
   *  where the download is agreed to, watched and called off. One word on a
   *  card, a whole list on the words screen.
   */
  import { onMount } from 'svelte';
  import { forgetSrc } from '$lib/audio.js';
  import { ENGINE_LABEL, MODEL_MB, cancel, clipsState, ensureClips, onStatus } from '$lib/tts.js';
  import { voiceDecision } from '$lib/voice.js';
  import type { VoiceAsk } from '$lib/voice.js';
  import type { VoiceStatus } from '$lib/tts.js';
  import type { UserWord } from '$lib/model.js';
  import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';

  /** `summary` marks the one that stands for a whole list: it stays out of the
   *  way until there is more than one word to do, since for a single word it
   *  would say exactly what that word's own row already says. */
  interface Props {
    /** The words this stands for: one on a card, a list on the words screen. */
    words?: UserWord[];
    compact?: boolean;
    summary?: boolean;
    onDone?: () => void;
  }

  /** A word whose audio is missing, or no longer says what the word says. */
  interface Outstanding { word: UserWord; state: 'missing' | 'stale' }

  let { words = [], compact = false, summary = false, onDone = () => {} }: Props = $props();

  let pending = $state<Outstanding[]>([]);
  let working = $state<{ done: number; total: number } | null>(null);
  let asking = $state<VoiceAsk | null>(null);
  let stopped = $state(false);       /* cancelled here: not a failure to report */
  let error = $state('');
  let voice = $state<VoiceStatus>({ phase: 'idle', text: '', progress: 0 });

  onMount(() => onStatus((st) => { voice = st; }));

  /* The words change under us — an edit, the next card — so what they need is
     read again whenever they do. */
  $effect(() => {
    const list = words;
    look(list).then((found) => { if (words === list) pending = found; }).catch(() => {});
  });

  async function look(list: UserWord[]): Promise<Outstanding[]> {
    const found: Outstanding[] = [];
    for (const word of list ?? []) {
      if (!word?.k) continue;
      const state = await clipsState(word);
      if (state === 'missing' || state === 'stale') found.push({ word, state });
    }
    return found;
  }

  async function start(): Promise<void> {
    error = '';
    const d = await voiceDecision();
    if ('no' in d) { error = d.reason; return; }
    if ('ask' in d) { asking = d; return; }
    void run();
  }

  function agree(): void {
    asking = null;
    void run();
  }

  async function run(): Promise<void> {
    const todo = pending.map((p) => p.word);
    stopped = false;
    working = { done: 0, total: todo.length };
    try {
      for (const word of todo) {
        await ensureClips(word);
        forgetSrc(word.k);
        working = { done: (working?.done ?? 0) + 1, total: todo.length };
      }
    } catch (err) {
      /* You stopping it is not an error. */
      if (!stopped) error = (err as Error).message;
    } finally {
      working = null;
      pending = await look(words).catch(() => pending);
      onDone();
    }
  }

  function stop(): void {
    stopped = true;
    cancel();
    working = null;
    asking = null;
  }

  const sentence = (text: string): string =>
    (text ? text[0]!.toUpperCase() + text.slice(1) : '');

  let stale = $derived(pending.filter((p) => p.state === 'stale').length);
  let what = $derived(
    pending.length === 1
      ? (stale ? 'Audio is out of date' : 'No audio yet')
      : `${pending.length} words ${stale === pending.length ? 'with out-of-date audio' : 'without audio'}`);
  let action = $derived(stale === pending.length ? 'Make it again' : 'Make audio');
</script>

{#if (summary ? pending.length > 1 : pending.length) || working || asking || error}
  <div class="voice" class:compact class:summary>
    {#if working}
      <div class="run">
        <span class="what">
          {voice.text || 'making audio'}…
          {#if working.total > 1}<b>{working.done + 1} of {working.total}</b>{/if}
        </span>
        <button class="stop" onclick={stop}><X size={15} /> Cancel</button>
      </div>
      {#if voice.phase === 'loading'}
        <progress value={voice.progress || 0} max="1"></progress>
      {/if}
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
    {:else if pending.length}
      <div class="run">
        <span class="what" class:warn={stale > 0}>
          {#if stale}<TriangleAlert size={14} />{/if}{what}
        </span>
        <button onclick={start}><AudioWaveform size={15} /> {action}</button>
      </div>
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
  .what { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); }
  .what.warn { color: var(--warn); }
  .ask { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
         margin: 0 0 8px; color: var(--ink); }
  .ask.urgent { color: var(--warn); }
  button.warn { border-color: var(--warn); color: var(--warn); }
  .row { display: flex; gap: 8px; }
  button { font: inherit; font-size: 13px; font-weight: 600; padding: 7px 12px;
           border-radius: 999px; border: 1px solid var(--line); background: var(--panel);
           color: var(--ink); cursor: pointer; }
  button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  button.stop { color: var(--bad); }
  progress { width: 100%; margin-top: 6px; accent-color: var(--accent); height: 6px; }
  .error { color: var(--bad); margin: 6px 0 0; }
</style>
