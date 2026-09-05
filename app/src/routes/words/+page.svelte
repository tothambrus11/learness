<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { search } from '$lib/catalogue.js';
  import { allCards } from '$lib/db.js';
  import {
    POS, activeUserWords, addLessonText, addWord, findInCatalogue, removeWord, statusOf,
  } from '$lib/words.js';
  import { getSettings, setSetting } from '$lib/db.js';
  import { connectionState, isOnline } from '$lib/network.js';
  import { bulkDownloadDecision } from '$lib/syncpolicy.js';
  import {
    CLIPS_PER_WORD, ENGINE_LABEL, MODEL_MB, ensureClips, generationState, loadTimes, missingClips,
    onStatus,
  } from '$lib/tts.js';
  import { allClips } from '$lib/db.js';
  import { duration, summariseTimings } from '$lib/timing.js';
  import { forgetSrc, srcFor } from '$lib/audio.js';
  import Fr from '$lib/components/Fr.svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';

  let mine = $state([]);
  let cards = $state([]);
  let query = $state('');
  let hits = $state([]);
  let exact = $state(null);
  let showForm = $state(false);
  let showPaste = $state(false);
  let form = $state({ fr: '', en: '', pos: 'noun', gender: '', note: '' });
  let paste = $state({ text: '', label: '' });
  let notice = $state('');
  let busy = $state(false);
  let voice = $state({ phase: 'idle', text: '', progress: 0 });   /* the on-device voices */
  let audio = $state({});          /* key -> 'ready' | 'partial' | 'none' | 'making' */
  let voiceError = $state('');
  let timings = $state([]);        /* what each voice cost here, measured */
  let loads = $state({});

  onMount(() => {
    refresh();
    return onStatus((st) => { voice = st; });
  });

  async function refresh() {
    [mine, cards] = await Promise.all([activeUserWords(), allCards()]);
    mine.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    const next = {};
    for (const w of mine) {
      if (w.source === 'catalogue') continue;           /* has the pipeline's files */
      const missing = await missingClips(w.k);
      next[w.k] = audio[w.k] === 'making' ? 'making'
        : missing.length === 0 ? 'ready'
          : missing.length === CLIPS_PER_WORD ? 'none' : 'partial';
    }
    audio = next;
    await measure();
  }

  /* The voice is timed on its own clips: the download and start-up once, the
     synthesis of every word after that. */
  async function measure() {
    const [clips, times] = await Promise.all([allClips(), loadTimes()]);
    timings = summariseTimings(clips, 'fr');
    loads = times;
  }

  /* Your own words get their sound from the on-device voice. The first time
     that means fetching the model, which is asked about like any big download. */
  async function mayGenerate() {
    const state = await generationState();
    if (state === 'unsupported') { voiceError = 'This browser cannot run the voice.'; return false; }
    if (state === 'offline') { voiceError = 'The voice needs one download first; you are offline.'; return false; }
    if (state === 'ready') return true;
    const settings = await getSettings();
    const d = bulkDownloadDecision({ policy: settings.bulkDownload, connection: connectionState(),
      online: isOnline(), consented: settings.bulkConsent });
    if (d.decision === 'no') { voiceError = `Audio downloads are off (${d.reason}).`; return false; }
    if (d.decision === 'ask') {
      if (!confirm(`${d.reason}. Fetch the ${MODEL_MB} MB voice once, so this device can make audio for your own words?`)) return false;
      await setSetting('bulkConsent', true);
    }
    return true;
  }

  async function makeAudio(w) {
    voiceError = '';
    if (!(await mayGenerate())) return;
    audio[w.k] = 'making';
    try {
      await ensureClips(w);
      forgetSrc(w.k);
      audio[w.k] = 'ready';
    } catch (err) {
      voiceError = err.message;
      audio[w.k] = (await missingClips(w.k)).length === CLIPS_PER_WORD ? 'none' : 'partial';
    }
    await measure();
  }

  async function makeAll() {
    for (const w of mine) if (audio[w.k] && audio[w.k] !== 'ready') await makeAudio(w);
  }

  async function hear(w, kind) {
    const src = await srcFor({ ...w, user: true }, kind);
    if (src) new Audio(src).play().catch(() => {});
  }

  let pendingAudio = $derived(mine.filter((w) => audio[w.k] && audio[w.k] !== 'ready').length);

  let searchSeq = 0;
  async function onQuery() {
    const q = query.trim();
    const seq = ++searchSeq;
    if (!q) { hits = []; exact = null; return; }
    const [h, e] = await Promise.all([search(q, 8), findInCatalogue(q)]);
    if (seq !== searchSeq) return;        /* a newer keystroke won */
    hits = h;
    exact = e;
  }

  const inList = (k) => mine.some((w) => w.k === k);

  async function promote(hit) {
    busy = true;
    try {
      await addWord({ fr: hit.fr, en: hit.en });
      notice = `${hit.fr} is up next.`;
      await refresh();
    } finally { busy = false; }
  }

  function startNew() {
    form = { fr: query.trim(), en: '', pos: 'noun', gender: '', note: '' };
    showForm = true;
  }

  async function submitNew() {
    if (!form.fr.trim()) return;
    busy = true;
    try {
      const en = form.en.split(/\s*[,;]\s*/).filter(Boolean);
      const res = await addWord({ ...form, en, gender: form.pos === 'noun' ? form.gender : '' });
      notice = res.promoted
        ? `${res.record.fr} was already in the catalogue, so it is promoted with its audio.`
        : `${res.record.fr} added; it is up next.`;
      showForm = false;
      query = ''; hits = []; exact = null;
      await refresh();
      /* Once the voice is on the device, new words get their sound at once. */
      if (!res.promoted && (await generationState()) === 'ready') makeAudio(res.record);
    } finally { busy = false; }
  }

  async function submitPaste() {
    if (!paste.text.trim()) return;
    busy = true;
    try {
      const added = await addLessonText(paste.text, paste.label.trim());
      const promoted = added.filter((a) => a.promoted).length;
      notice = `${added.length} words added, ${promoted} of them from the catalogue with audio.`;
      paste = { text: '', label: '' };
      showPaste = false;
      await refresh();
    } finally { busy = false; }
  }

  async function drop(w) {
    await removeWord(w.k);
    await refresh();
  }

  const gloss = (w) => (Array.isArray(w.en) ? w.en : [w.en]).filter(Boolean).slice(0, 3).join(' · ');
</script>

<header>
  <button class="link" onclick={() => goto(`${base}/`)}><ArrowLeft size={14} /> Progress</button>
  <h1>Your words</h1>
</header>

<p class="muted small">
  Anything from a lesson or the street. A word the catalogue already has is
  simply moved to the front, audio and all; a new one is studied from what you
  type. Either way it comes before the mined words in the next sitting.
</p>

<section class="panel">
  <input type="text" bind:value={query} oninput={onQuery} placeholder="French or English…"
         autocomplete="off" autocapitalize="none" spellcheck="false" />
  {#if hits.length}
    <ul class="hits">
      {#each hits as h (h.k)}
        <li>
          <span><b><Fr text={h.fr} gender={h.gender} /></b>
            <span class="muted">{gloss(h)} · level {h.lvl}</span></span>
          {#if inList(h.k)}
            <span class="muted small">in your list</span>
          {:else}
            <button class="small-btn" onclick={() => promote(h)} disabled={busy}><Plus size={14} /> Add</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if query.trim() && !exact && !showForm}
    <button class="link add-new" onclick={startNew}>
      <Plus size={15} /> Add &ldquo;{query.trim()}&rdquo; as a new word
    </button>
  {/if}

  {#if showForm}
    <form class="new" onsubmit={(e) => { e.preventDefault(); submitNew(); }}>
      <label>French <input type="text" bind:value={form.fr} required autocapitalize="none"
                           placeholder="le natel" /></label>
      <label>English <input type="text" bind:value={form.en}
                            placeholder="mobile phone, cell phone" /></label>
      <div class="row">
        <label>Part of speech
          <select bind:value={form.pos}>{#each POS as p}<option value={p}>{p}</option>{/each}</select>
        </label>
        {#if form.pos === 'noun'}
          <label>Gender
            <select bind:value={form.gender}>
              <option value="">—</option><option value="m">m</option><option value="f">f</option>
            </select>
          </label>
        {/if}
      </div>
      <label>Note <input type="text" bind:value={form.note} placeholder="optional" /></label>
      <div class="row">
        <button type="submit" class="primary" disabled={busy}>Add word</button>
        <button type="button" onclick={() => (showForm = false)}>Cancel</button>
      </div>
    </form>
  {/if}
</section>

<button class="link" onclick={() => (showPaste = !showPaste)}>
  {#if showPaste}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if} Paste a lesson list
</button>
{#if showPaste}
  <section class="panel">
    <form onsubmit={(e) => { e.preventDefault(); submitPaste(); }}>
      <label>Lesson <input type="text" bind:value={paste.label} placeholder="e.g. 5 Sept, at the market" /></label>
      <label>Words, one per line
        <textarea bind:value={paste.text} rows="6"
                  placeholder={'la caisse = till, checkout\nle rayon = shelf, aisle\nune bonne affaire'}></textarea>
      </label>
      <p class="muted small">&ldquo;french = english&rdquo; per line; the English is optional for a word the catalogue knows.</p>
      <button type="submit" class="primary" disabled={busy}>Add all</button>
    </form>
  </section>
{/if}

{#if notice}<p class="notice">{notice}</p>{/if}

{#if pendingAudio || voice.phase === 'loading' || voice.phase === 'busy' || voiceError}
  <section class="panel voice">
    <div>
      <b><AudioWaveform size={15} /> Audio for your own words</b>
      <p class="muted small">
        {#if voice.phase === 'loading'}
          {voice.text}…
        {:else if voice.phase === 'busy'}
          {voice.text}…
        {:else if voiceError || voice.phase === 'error'}
          {voiceError || voice.text}
        {:else}
          {pendingAudio} word{pendingAudio === 1 ? '' : 's'} without sound. Made here, on this
          device, in {ENGINE_LABEL}'s French and English voices; the voice itself is a one-time
          {MODEL_MB} MB download.
        {/if}
      </p>
      {#if voice.phase === 'loading' && voice.progress > 0}
        <progress value={voice.progress} max="1"></progress>
      {/if}
    </div>
    {#if pendingAudio && voice.phase !== 'loading' && voice.phase !== 'busy'}
      <button onclick={makeAll}><AudioWaveform size={15} /> Make audio</button>
    {/if}
  </section>
{/if}

{#if timings.length}
  {@const row = timings[0]}
  <section class="panel">
    <h2>What the voice costs here</h2>
    <table class="timings">
      <thead>
        <tr><th>French words</th><th>Per word</th><th>× real time</th><th>First load</th><th>Running on</th></tr>
      </thead>
      <tbody>
        <tr>
          <td class="num">{row.clips}</td>
          <td class="num">{duration(row.perWord)}</td>
          <td class="num">{row.rtf == null ? '—' : `${row.rtf.toFixed(2)}×`}</td>
          <td class="num">{duration(loads[row.engine]?.loadMs)}</td>
          <td>{row.backend === 'webgpu' ? 'WebGPU' : row.backend ? 'WebAssembly' : '—'}</td>
        </tr>
      </tbody>
    </table>
    <p class="muted small">
      Median of the French clips on this device, timed inside the worker: the first load
      is the model being fetched and started, and is not counted in the per-word figure.
      Under one times real time means the voice speaks faster than the speech it makes.
    </p>
  </section>
{/if}

<section class="panel list">
  <h2>{mine.length ? `${mine.length} in your list` : 'Nothing added yet'}</h2>
  <ul>
    {#each mine as w (w.k)}
      <li>
        <span>
          <b><Fr text={w.fr} gender={w.gender} /></b>
          <span class="muted">{gloss(w)}</span>
          {#if w.note}<span class="muted small"> · {w.note}</span>{/if}
        </span>
        <span class="right">
          {#if audio[w.k] === 'ready'}
            <button class="x" onclick={() => hear(w, 'fr')} aria-label="Hear {w.fr}"><Volume2 size={16} /></button>
          {:else if audio[w.k] === 'making'}
            <span class="muted small">making audio…</span>
          {:else if audio[w.k]}
            <button class="x" onclick={() => makeAudio(w)} aria-label="Make audio for {w.fr}"
                    title="Make audio"><AudioWaveform size={16} /></button>
          {/if}
          <span class="status" class:known={statusOf(w.k, cards) === 'known'}>{statusOf(w.k, cards)}</span>
          {#if w.lesson}<span class="muted small">{w.lesson}</span>{/if}
          <button class="x" onclick={() => drop(w)} aria-label="Remove {w.fr}"><X size={18} /></button>
        </span>
      </li>
    {/each}
  </ul>
</section>

<style>
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
       color: var(--muted); margin: 0 0 8px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
           padding: 14px; margin-bottom: 12px; }
  input, select, textarea { font: inherit; width: 100%; padding: 9px 11px; border-radius: 10px;
                            border: 1px solid var(--line); background: var(--bg); color: var(--ink);
                            box-sizing: border-box; }
  textarea { resize: vertical; }
  label { display: block; font-size: 13px; color: var(--muted); margin-top: 10px; }
  label input, label select, label textarea { margin-top: 4px; color: var(--ink); font-size: 15px; }
  .row { display: flex; gap: 10px; align-items: end; }
  .row label { flex: 1; }
  .row button { margin-top: 12px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .hits { margin-top: 8px; }
  li { display: flex; justify-content: space-between; align-items: center; gap: 10px;
       padding: 8px 0; border-top: 1px solid var(--line); }
  .hits li:first-child { border-top: none; }
  .list li:first-child { border-top: none; }
  .right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .status { font-size: 12px; color: var(--muted); }
  .status.known { color: var(--good); }
  button { font: inherit; font-weight: 600; padding: 9px 14px; border-radius: 10px;
           border: 1px solid var(--line); background: var(--panel); color: var(--ink);
           cursor: pointer; }
  button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  button.small-btn { padding: 5px 12px; font-size: 13px; }
  button.link { border: none; background: none; color: var(--accent); padding: 6px 0;
                font-weight: 500; font-size: 14px; display: flex; justify-content: flex-start; }
  header button.link { color: var(--muted); font-weight: 400; font-size: 13px; }
  .add-new { margin-top: 8px; }
  button.x { border: none; background: none; color: var(--muted); padding: 4px; }
  .timings { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .timings th { text-align: left; font-weight: 500; color: var(--muted); font-size: 12px;
                text-transform: uppercase; letter-spacing: .05em; padding: 0 8px 6px 0; }
  .timings td { padding: 6px 8px 6px 0; border-top: 1px solid var(--line); }
  .timings .num { font-variant-numeric: tabular-nums; }
  button:disabled { opacity: .6; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  .notice { font-size: 14px; color: var(--good); }
  .voice { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .voice p { margin: 4px 0 0; }
  .voice b { display: inline-flex; align-items: center; gap: 6px; }
  progress { width: 100%; margin-top: 6px; accent-color: var(--accent); }
</style>
