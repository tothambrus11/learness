<script lang="ts">
  /** The audio for words you added yourself, wherever they are shown: one word
   *  on a card, a whole list on the words screen. */

  /* Says what is wrong — no clips yet, or clips left over from before the word
     was corrected — and makes them here rather than sending you to another
     screen. The first time, that means fetching the voice, so this is also
     where the download is agreed to, watched and called off. */

  import { forgetSrc } from '$lib/audio';
  import { ENGINE_LABEL, MODEL_MB, cancel, clipsState, ensureClips, onStatus } from '$lib/tts';
  import type { ClipsState, VoiceStatus } from '$lib/tts';
  import type { StudyWord } from '$lib/types';
  import { voiceDecision } from '$lib/voice';
  import type { VoiceDecision } from '$lib/voice';
  import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import { onMount } from 'svelte';

  /** The words to speak, how much room there is to say so, and who to tell
   *  when the work is done. */
  interface Props {
    /** The words this stands for, already resolved. Only the ones missing or
     *  holding stale clips are acted on, so a list that is entirely done shows
     *  nothing at all. */
    words?: StudyWord[];
    /** True in a tight spot — beside one word in a list — where the row is
     *  pushed to the right and nothing is explained. */
    compact?: boolean;
    /* For a single word it would say exactly what that word's own row says. */
    /** True on the one that stands for a whole list: it stays out of the way
     *  until there is more than one word to do. */
    summary?: boolean;
    /** Called after a run finishes, however it finished, so the screen around
     *  can read its words again and pick up the new audio. */
    onDone?: () => void;
  }

  let { words = [], compact = false, summary = false, onDone = () => {} }: Props = $props();

  /** One word that has no audio, or audio made before it was corrected. */
  interface Missing {
    /** The word itself, as it will be handed to the voice. */
    word: StudyWord;
    /** Why it is here: `missing` or `stale`, as `clipsState()` names them. */
    state: ClipsState;
  }

  /** How far a run has got. Null whenever nothing is being made. */
  interface Progress {
    /** Words finished so far. */
    done: number;
    /** Words the run started with. */
    total: number;
  }

  /** The words that still want audio, missing or stale. Empty when there is
   *  nothing to do. */
  let pending = $state<Missing[]>([]);
  /** How far the run on now has got; null whenever nothing is being made. */
  let working = $state<Progress | null>(null);
  /** The voice download waiting to be agreed to, or null when none is. */
  let asking = $state<VoiceDecision | null>(null);
  /** True once the run was called off here, which keeps the error the engine
   *  throws out of the panel: cancelling is not a failure to report. */
  let stopped = $state(false);
  /** What went wrong, shown under the row. Empty after a run you called off. */
  let error = $state('');
  /** What the voice itself is doing, as the engine reports it: the sentence
   *  shown while a run is on, and the model download's progress. */
  let voice = $state<VoiceStatus>({ phase: 'idle', text: '', progress: 0 });

  onMount(() =>
    onStatus((st) => {
      voice = st;
    }),
  );

  /* The words change under us — an edit, the next card — so what they need is
     read again whenever they do. */
  $effect(() => {
    const list = words;
    look(list)
      .then((found) => {
        if (words === list) pending = found;
      })
      .catch(() => {});
  });

  /* The voice throws an `Error`, but `catch` hands back `unknown`, so it is
     narrowed rather than asserted. */
  /** What went wrong, as a sentence. */
  const messageOf = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  /** Which of these words still want audio. A word with no key is skipped. */
  async function look(list: StudyWord[]): Promise<Missing[]> {
    /* Asked of the clip store one word at a time, so a long list does not block
       on a single slow read. */
    const found: Missing[] = [];
    for (const word of list ?? []) {
      if (!word?.k) continue;
      const state = await clipsState(word);
      if (state === 'missing' || state === 'stale') found.push({ word, state });
    }
    return found;
  }

  /** Begin, once the voice is allowed to run: straight away where it is
   *  already on the device or the policy says yes, otherwise by asking. */
  async function start() {
    error = '';
    const d = await voiceDecision();
    if (d.no) {
      error = d.reason ?? '';
      return;
    }
    if (d.ask) {
      asking = d;
      return;
    }
    run();
  }

  /** The download agreed to, here on the panel rather than in a confirm box. */
  function agree() {
    asking = null;
    run();
  }

  /** Make the clips, one word at a time, forgetting each word's cached audio
   *  source as it lands so the next play picks up the new one. Whatever
   *  happens, the list is read again and the caller told. */
  async function run() {
    const todo = pending.map((p) => p.word);
    stopped = false;
    working = { done: 0, total: todo.length };
    try {
      for (const word of todo) {
        await ensureClips(word);
        forgetSrc(word.k);
        working = { done: working.done + 1, total: todo.length };
      }
    } catch (err) {
      if (!stopped) error = messageOf(err); /* you stopping it is not an error */
    } finally {
      working = null;
      pending = await look(words).catch(() => pending);
      onDone();
    }
  }

  /** Call the run off. The engine is told, and the flag keeps the error that
   *  comes back out of the panel. */
  function stop() {
    stopped = true;
    cancel();
    working = null;
    asking = null;
  }

  /** A reason with its first letter raised, so it can start a sentence of its
   *  own. Empty in, empty out. */
  const sentence = (text?: string): string =>
    text ? text[0].toUpperCase() + text.slice(1) : '';

  /** How many of the pending words have audio that is merely out of date, as
   *  against none at all. */
  let stale = $derived(pending.filter((p) => p.state === 'stale').length);
  /** What is wrong, in the words the row shows. */
  let what = $derived(
    pending.length === 1
      ? stale
        ? 'Audio is out of date'
        : 'No audio yet'
      : `${pending.length} words ${stale === pending.length ? 'with out-of-date audio' : 'without audio'}`,
  );
  /** What the button offers, which reads differently for audio being made again
   *  than for audio being made at all. */
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
        Your own words are spoken here, on this device, in {ENGINE_LABEL}'s French and English
        voices; the voice itself is a one-time {MODEL_MB} MB download.
      </p>
    {/if}
  </div>
{/if}

<style>
  .voice {
    width: 100%;
    font-size: 13px;
  }
  .voice.summary {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 14px;
    margin-bottom: 12px;
    box-sizing: border-box;
  }
  .note {
    color: var(--muted);
    margin: 8px 0 0;
  }
  .run {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .compact .run {
    justify-content: flex-end;
  }
  .what {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--muted);
  }
  .what.warn {
    color: var(--warn);
  }
  .ask {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
    margin: 0 0 8px;
    color: var(--ink);
  }
  .ask.urgent {
    color: var(--warn);
  }
  button.warn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  button {
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  button.stop {
    color: var(--bad);
  }
  progress {
    width: 100%;
    margin-top: 6px;
    accent-color: var(--accent);
    height: 6px;
  }
  .error {
    color: var(--bad);
    margin: 6px 0 0;
  }
</style>
