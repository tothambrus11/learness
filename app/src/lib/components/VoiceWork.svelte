<script>
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
  import { cancel, clipsState, ensureClips, onStatus } from '$lib/tts.js';
  import { voiceDecision } from '$lib/voice.js';
  import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';

  let { words = [], compact = false, onDone = () => {} } = $props();

  let pending = $state([]);          /* [{ word, state }] — missing or stale */
  let working = $state(null);        /* { done, total } while making */
  let asking = $state(null);         /* the download, waiting to be agreed to */
  let stopped = $state(false);       /* cancelled here: not a failure to report */
  let error = $state('');
  let voice = $state({ phase: 'idle', text: '', progress: 0 });

  onMount(() => onStatus((st) => { voice = st; }));

  /* The words change under us — an edit, the next card — so what they need is
     read again whenever they do. */
  $effect(() => {
    const list = words;
    look(list).then((found) => { if (words === list) pending = found; }).catch(() => {});
  });

  async function look(list) {
    const found = [];
    for (const word of list ?? []) {
      if (!word?.k) continue;
      const state = await clipsState(word);
      if (state === 'missing' || state === 'stale') found.push({ word, state });
    }
    return found;
  }

  async function start() {
    error = '';
    const d = await voiceDecision();
    if (d.no) { error = d.reason; return; }
    if (d.ask) { asking = d; return; }
    run();
  }

  function agree() {
    asking = null;
    run();
  }

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
      if (!stopped) error = err.message;      /* you stopping it is not an error */
    } finally {
      working = null;
      pending = await look(words).catch(() => pending);
      onDone();
    }
  }

  function stop() {
    stopped = true;
    cancel();
    working = null;
    asking = null;
  }

  const sentence = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '');

  let stale = $derived(pending.filter((p) => p.state === 'stale').length);
  let what = $derived(
    pending.length === 1
      ? (stale ? 'Audio is out of date' : 'No audio yet')
      : `${pending.length} words ${stale === pending.length ? 'with out-of-date audio' : 'without audio'}`);
  let action = $derived(stale === pending.length ? 'Make it again' : 'Make audio');
</script>

{#if pending.length || working || asking || error}
  <div class="voice" class:compact>
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
  </div>
{/if}

<style>
  .voice { width: 100%; font-size: 13px; }
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
  button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  button.stop { color: var(--bad); }
  progress { width: 100%; margin-top: 6px; accent-color: var(--accent); height: 6px; }
  .error { color: var(--bad); margin: 6px 0 0; }
</style>
