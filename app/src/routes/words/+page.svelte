<script>
  import { onMount } from 'svelte';
  import { search } from '$lib/catalogue.js';
  import { allCards } from '$lib/db.js';
  import {
    NUMBERS, POS, activeUserWords, addLessonText, addWord, anyWord, editWord, findInCatalogue,
    removeWord, statusOf, toStudyWord,
  } from '$lib/words.js';
  import { isIncomplete, listFields, matchWords, missingFields, sortForList } from '$lib/wordform.js';
  import { loadTimes } from '$lib/tts.js';
  import { allClips } from '$lib/db.js';
  import { duration, summariseTimings } from '$lib/timing.js';
  import { srcFor } from '$lib/audio.js';
  import Fr from '$lib/components/Fr.svelte';
  import VoiceWork from '$lib/components/VoiceWork.svelte';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';

  const EMPTY_FORM = { fr: '', en: '', pos: 'noun', gender: '', number: '', note: '' };

  let mine = $state([]);
  let cards = $state([]);
  let query = $state('');
  let hits = $state([]);
  let exact = $state(null);
  let showForm = $state(false);
  let showPaste = $state(false);
  let form = $state({ ...EMPTY_FORM });
  let editing = $state(null);          /* key of the word whose form is open */
  let editForm = $state({ ...EMPTY_FORM });
  let paste = $state({ text: '', label: '' });
  let notice = $state('');
  let busy = $state(false);
  let warning = $state('');            /* about to save a word that cannot be asked */
  let playable = $state({});           /* key -> can be heard right now */
  /* How each word reads on a card: a promoted one takes the catalogue's gender
     and IPA, which your own record does not carry, with your corrections over
     the top. Without this the list showed a gender the card did not. */
  let shown = $state({});              /* key -> the word as the study screens see it */
  let timings = $state([]);            /* what the voice cost here, measured */
  let loads = $state({});

  onMount(refresh);

  async function refresh() {
    const [words, all] = await Promise.all([activeUserWords(), allCards()]);
    mine = sortForList(words);
    cards = all;
    const byKey = new Map(mine.map((w) => [w.k, w]));
    const words_ = {};
    const next = {};
    for (const w of mine) {
      const resolved = (await anyWord(w.k, byKey).catch(() => null)) ?? toStudyWord(w);
      words_[w.k] = resolved;
      next[w.k] = !!(await srcFor(resolved, 'fr'));
    }
    shown = words_;
    playable = next;
    await measure();
  }

  const asCard = (w) => shown[w.k] ?? toStudyWord(w);

  /* The voice is timed on its own clips: the download and start-up once, the
     synthesis of every word after that. */
  async function measure() {
    const [clips, times] = await Promise.all([allClips(), loadTimes()]);
    timings = summariseTimings(clips, 'fr');
    loads = times;
  }

  async function hear(w, kind) {
    const src = await srcFor(asCard(w), kind);
    if (src) new Audio(src).play().catch(() => {});
  }

  /* The words the voice can work on: your own, not the ones promoted out of the
     catalogue, which have recordings already. */
  let voiceable = $derived(mine.filter((w) => w.source !== 'catalogue').map(toStudyWord));

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

  /* The same box searches both: your own words, which it narrows the list to,
     and the catalogue, which it offers to add from. A catalogue word already in
     your list is left out of the hits — it is in the list below, where every
     action it has lives. */
  let filtering = $derived(!!query.trim());
  let shownList = $derived(filtering ? matchWords(mine, query) : mine);
  let offered = $derived(hits.filter((h) => !inList(h.k)));

  async function promote(hit) {
    busy = true;
    try {
      const res = await addWord({ fr: hit.fr, en: hit.en });
      notice = res.promoted
        ? `${hit.fr} is up next, with its audio.`
        : `${hit.fr} is up next.`;
      query = ''; hits = []; exact = null;
      await refresh();
    } finally { busy = false; }
  }

  function startNew(own = false) {
    form = { ...EMPTY_FORM, fr: query.trim(), own };
    warning = '';
    showForm = true;
  }

  /** A word with no English cannot be asked in either direction, so it is said
   *  once before it is saved. Pressing again saves it anyway: half a word
   *  written down beats a word forgotten, and the list flags it afterwards. */
  function guard(rec) {
    const missing = missingFields(rec);
    if (!missing.length || warning) { warning = ''; return true; }
    warning = `No ${listFields(missing)} yet — this card cannot be asked until it `
      + 'has one. Save it anyway?';
    return false;
  }

  const parseEn = (text) => text.split(/\s*[,;·]\s*/).filter(Boolean);

  async function submitNew() {
    if (!form.fr.trim()) return;
    const en = parseEn(form.en);
    if (!guard({ fr: form.fr, en })) return;
    busy = true;
    try {
      const res = await addWord({ ...form, en, gender: form.pos === 'noun' ? form.gender : '',
        number: form.pos === 'noun' ? form.number : '' });
      notice = res.promoted
        ? `${res.record.fr} was already in the catalogue, so it is promoted with its audio.`
        : `${res.record.fr} added; it is up next.`;
      showForm = false;
      warning = '';
      query = ''; hits = []; exact = null;
      await refresh();
    } finally { busy = false; }
  }

  async function submitPaste() {
    if (!paste.text.trim()) return;
    busy = true;
    try {
      const added = await addLessonText(paste.text, paste.label.trim());
      const promoted = added.filter((a) => a.promoted).length;
      const short = added.filter((a) => isIncomplete(a.record)).length;
      notice = `${added.length} words added, ${promoted} of them from the catalogue with audio.`
        + (short ? ` ${short} still need an English translation.` : '');
      paste = { text: '', label: '' };
      showPaste = false;
      await refresh();
    } finally { busy = false; }
  }

  async function drop(w) {
    await removeWord(w.k);
    await refresh();
  }

  /* Correcting a word keeps its key, so its cards and reviews stay attached:
     fixing "une erreur" to "l'erreur" is a spelling change, not a new word. */
  function startEdit(w) {
    editing = w.k;
    warning = '';
    editForm = { fr: w.fr, en: gloss(w, 10), pos: w.pos || 'other', gender: w.gender || '',
      number: w.number || '', note: w.note || '' };
  }

  async function submitEdit() {
    if (!editing || !editForm.fr.trim()) return;
    const en = parseEn(editForm.en);
    if (!guard({ fr: editForm.fr, en })) return;
    busy = true;
    try {
      const rec = await editWord(editing, { ...editForm, en,
        gender: editForm.pos === 'noun' ? editForm.gender : '',
        number: editForm.pos === 'noun' ? editForm.number : '' });
      notice = rec ? `${toStudyWord(rec).fr} updated; its history is untouched.` : '';
      editing = null;
      warning = '';
      await refresh();
    } finally { busy = false; }
  }

  const gloss = (w, n = 3) => (Array.isArray(w.en) ? w.en : [w.en]).filter(Boolean).slice(0, n).join(' · ');
</script>

<p class="muted small">
  Anything from a lesson or the street. A word the catalogue already has is
  simply moved to the front, audio and all; a new one is studied from what you
  type. Either way it comes before the mined words in the next sitting.
</p>

<section class="panel">
  <input type="text" bind:value={query} oninput={onQuery} placeholder="French or English…"
         autocomplete="off" autocapitalize="none" spellcheck="false" />
  {#if offered.length}
    <p class="from muted small">From the catalogue</p>
    <ul class="hits">
      {#each offered as h (h.k)}
        <li>
          <span><b><Fr text={h.fr} gender={h.gender} /></b>
            <span class="muted">{gloss(h)} · level {h.lvl}</span></span>
          <button class="small-btn" onclick={() => promote(h)} disabled={busy}><Plus size={14} /> Add</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if query.trim() && !showForm}
    <!-- Always a way through. When the catalogue has the word, adding it from
         there is the better answer, but the word you mean may be a different
         one — a local sense, another gender — so your own is never blocked. -->
    <button class="link add-new" onclick={() => startNew(!!exact)}>
      <Plus size={15} />
      {exact
        ? `Add “${query.trim()}” as my own word instead`
        : `Add “${query.trim()}” as a new word`}
    </button>
  {/if}

  {#if showForm}
    <form class="new" onsubmit={(e) => { e.preventDefault(); submitNew(); }}>
      <label>French <input type="text" bind:value={form.fr} required autocapitalize="none"
                           placeholder="le natel" /></label>
      <label>English <input type="text" bind:value={form.en} oninput={() => (warning = '')}
                            placeholder="mobile phone, cell phone" /></label>
      <div class="row">
        <label>Part of speech
          <select bind:value={form.pos}>{#each POS as p}<option value={p}>{p}</option>{/each}</select>
        </label>
        {#if form.pos === 'noun'}
          <label>Gender
            <select bind:value={form.gender}>
              <option value="">—</option><option value="m">m</option>
              <option value="f">f</option><option value="mf">either</option>
            </select>
          </label>
          <label>Number
            <select bind:value={form.number}>
              {#each NUMBERS as n}<option value={n}>{n === 'pl' ? 'plural' : 'singular'}</option>{/each}
            </select>
          </label>
        {/if}
      </div>
      <label>Note <input type="text" bind:value={form.note} placeholder="optional" /></label>
      {#if warning}<p class="warning"><TriangleAlert size={15} /> {warning}</p>{/if}
      <div class="row">
        <button type="submit" class="primary" disabled={busy}>
          {warning ? 'Save anyway' : 'Add word'}
        </button>
        <button type="button" onclick={() => { showForm = false; warning = ''; }}>Cancel</button>
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

<VoiceWork words={voiceable} summary onDone={refresh} />

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
  <h2>
    {#if filtering}
      {shownList.length} of {mine.length} matching
    {:else}
      {mine.length ? `${mine.length} in your list` : 'Nothing added yet'}
    {/if}
  </h2>
  {#if filtering && !shownList.length && mine.length}
    <p class="muted small">Nothing in your list matches. The catalogue may still have it.</p>
  {/if}
  <ul>
    {#each shownList as w (w.k)}
      <li class:unfinished={isIncomplete(w)}>
        {#if editing === w.k}
          <form class="edit" onsubmit={(e) => { e.preventDefault(); submitEdit(); }}>
            <label>French <input type="text" bind:value={editForm.fr} required autocapitalize="none"
                                 autocorrect="off" spellcheck="false" /></label>
            <label>English <input type="text" bind:value={editForm.en} placeholder="comma-separated"
                                  oninput={() => (warning = '')} /></label>
            <div class="row">
              <label>Part of speech
                <select bind:value={editForm.pos}>{#each POS as p}<option value={p}>{p}</option>{/each}</select>
              </label>
              {#if editForm.pos === 'noun'}
                <label>Gender
                  <select bind:value={editForm.gender}>
                    <option value="">unknown</option><option value="m">m</option>
                    <option value="f">f</option><option value="mf">either</option>
                  </select>
                </label>
                <label>Number
                  <select bind:value={editForm.number}>
                    {#each NUMBERS as n}<option value={n}>{n === 'pl' ? 'plural' : 'singular'}</option>{/each}
                  </select>
                </label>
              {/if}
            </div>
            <label>Note <input type="text" bind:value={editForm.note} placeholder="optional" /></label>
            {#if warning}<p class="warning"><TriangleAlert size={15} /> {warning}</p>{/if}
            <div class="actions">
              <button type="button" onclick={() => { editing = null; warning = ''; }}>Cancel</button>
              <button type="submit" class="primary" disabled={busy}>
                {warning ? 'Save anyway' : 'Save'}
              </button>
            </div>
            <p class="muted small">Its cards and history stay attached whatever you change.</p>
          </form>
        {:else}
        {@const card = asCard(w)}
        <div class="word">
          <span>
            {#if isIncomplete(w)}
              <span class="flag" title="No {listFields(missingFields(w))} yet"><TriangleAlert size={15} /></span>
            {/if}
            <b><Fr text={card.fr} gender={card.gender} number={card.number ?? ''} /></b>
            {#if isIncomplete(w)}
              <button class="fix" onclick={() => startEdit(w)}>
                needs {listFields(missingFields(w))} — fix this
              </button>
            {:else}
              <span class="muted">{gloss(w)}</span>
            {/if}
            {#if w.note}<span class="muted small"> · {w.note}</span>{/if}
          </span>
          <span class="right">
            <button class="x" onclick={() => startEdit(w)} aria-label="Edit {w.fr}" title="Edit"><Pencil size={15} /></button>
            {#if playable[w.k]}
              <button class="x" onclick={() => hear(w, 'fr')} aria-label="Hear {w.fr}"><Volume2 size={16} /></button>
            {/if}
            <span class="status" class:known={statusOf(w.k, cards) === 'known'}>{statusOf(w.k, cards)}</span>
            {#if w.lesson}<span class="muted small">{w.lesson}</span>{/if}
            <button class="x" onclick={() => drop(w)} aria-label="Remove {w.fr}"><X size={18} /></button>
          </span>
        </div>
        {#if w.source !== 'catalogue'}
          <VoiceWork words={[toStudyWord(w)]} compact onDone={refresh} />
        {/if}
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
       color: var(--muted); margin: 0 0 8px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
           padding: 14px; margin-bottom: 12px; }
  input, select, textarea { font: inherit; width: 100%; padding: 9px 11px; border-radius: 10px;
                            border: 1px solid var(--line); background: var(--bg); color: var(--ink);
                            box-sizing: border-box; }
  textarea { resize: vertical; }
  label { display: block; font-size: 13px; color: var(--muted); margin-top: 10px; }
  /* The edit form sits inside the word's own row, full width. */
  li form.edit { flex: 1; width: 100%; padding: 4px 0 6px; }
  li form.edit .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
  li form.edit .actions button { font: inherit; font-weight: 600; padding: 9px 14px; border-radius: 10px;
                                  border: 1px solid var(--line); background: var(--panel); color: var(--ink); }
  li form.edit .actions button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  li form.edit p { margin: 8px 0 0; }
  label input, label select, label textarea { margin-top: 4px; color: var(--ink); font-size: 15px; }
  .row { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
  .row label { flex: 1; min-width: 7em; }
  .row button { margin-top: 12px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .hits { margin-top: 8px; }
  li { padding: 8px 0; border-top: 1px solid var(--line); }
  .hits li, .word { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .hits li:first-child { border-top: none; }
  .list li:first-child { border-top: none; }
  /* A word that cannot be asked yet: first in the list, and marked. */
  .list li.unfinished { border-left: 3px solid var(--bad); padding-left: 10px;
                        margin-left: -13px; }
  .flag { color: var(--bad); display: inline-flex; vertical-align: -.2em; margin-right: 4px; }
  .fix { border: none; background: none; color: var(--bad); font: inherit; font-size: 13px;
         padding: 0 0 0 4px; cursor: pointer; text-decoration: underline; }
  .right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .status { font-size: 12px; color: var(--muted); }
  .status.known { color: var(--good); }
  button { font: inherit; font-weight: 600; padding: 9px 14px; border-radius: 10px;
           border: 1px solid var(--line); background: var(--panel); color: var(--ink);
           cursor: pointer; }
  button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  button.small-btn { padding: 5px 12px; font-size: 13px; }
  button.link { border: none; background: none; color: var(--accent); padding: 6px 0;
                font-weight: 500; font-size: 14px; display: flex; justify-content: flex-start; }
  .add-new { margin-top: 8px; }
  .from { margin: 12px 0 0; text-transform: uppercase; letter-spacing: .06em; font-size: 11.5px; }
  button.x { border: none; background: none; color: var(--muted); padding: 4px; }
  .warning { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--warn);
             background: color-mix(in srgb, var(--warn) 10%, transparent);
             border: 1px solid var(--warn); border-radius: 10px; padding: 9px 11px;
             margin: 12px 0 0; }
  .timings { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .timings th { text-align: left; font-weight: 500; color: var(--muted); font-size: 12px;
                text-transform: uppercase; letter-spacing: .05em; padding: 0 8px 6px 0; }
  .timings td { padding: 6px 8px 6px 0; border-top: 1px solid var(--line); }
  .timings .num { font-variant-numeric: tabular-nums; }
  button:disabled { opacity: .6; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  .notice { font-size: 14px; color: var(--good); }
</style>
