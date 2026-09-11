<script lang="ts">
  import { srcFor } from '$lib/audio';
  import { search } from '$lib/catalogue';
  import Fr from '$lib/components/Fr.svelte';
  import VoiceWork from '$lib/components/VoiceWork.svelte';
  import { allCards, allClips } from '$lib/db';
  import type { TimingRow } from '$lib/timing';
  import { duration, summariseTimings } from '$lib/timing';
  import { loadTimes } from '$lib/tts';
  import type { Card, CatalogueEntry, StudyWord, UserWord, WordKey } from '$lib/types';
  import type { WordRecord } from '$lib/wordform';
  import {
    isIncomplete,
    listFields,
    matchWords,
    missingFields,
    sortForList,
  } from '$lib/wordform';
  import {
    NUMBERS,
    POS,
    activeUserWords,
    addLessonText,
    addWord,
    anyWord,
    editWord,
    findInCatalogue,
    removeWord,
    statusOf,
    toStudyWord,
  } from '$lib/words';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import X from '@lucide/svelte/icons/x';
  import { onMount } from 'svelte';

  /** The add and edit forms, as they are while being typed. Every field is
   *  present and possibly empty, so a form never reads back as undefined. */

  /* `en` is one string here, not the list a record holds: it is what is in the
     field, and `parseEn()` splits it on the way to being saved. */
  interface WordForm {
    /** The French as typed, article and all. */
    fr: string;
    /** Translations as one string, separated by commas, semicolons or middots. */
    en: string;
    /** `noun` | `verb` | `adj` | `adv` | `phrase` | `other`, from POS. */
    pos: string;
    /** `m` | `f` | `mf` | `''`. Written only for a noun. */
    gender: string;
    /** `pl` | `''`, from NUMBERS. Written only for a noun. */
    number: string;
    /** Whatever you want to remember about it; may be empty. */
    note: string;
  }

  /** The add form, which can additionally insist on being your own word. */
  interface NewWordForm extends WordForm {
    /** True to keep what was typed even where the catalogue has the word: the
     *  entry it has may be a different sense, gender or local usage. */
    own?: boolean;
  }

  /** What a form starts as, and what Cancel puts it back to. Spread rather than
   *  assigned, so the two forms never share one object. */
  const EMPTY_FORM: WordForm = {
    fr: '',
    en: '',
    pos: 'noun',
    gender: '',
    number: '',
    note: '',
  };

  /** Your own words, sorted for the list: the unfinished ones first. */
  let mine = $state<UserWord[]>([]);
  /** Every card on the device, for the status beside each word. */
  let cards = $state<Card[]>([]);
  /** What is in the search box, which filters your list and searches the
   *  catalogue at the same time. */
  let query = $state('');
  /** Catalogue hits for the query, best first; `offered` drops the ones you
   *  already have. */
  let hits = $state<CatalogueEntry[]>([]);
  /** The catalogue entry that is the same word as the query, or null. Its
   *  presence changes what the "add my own" button offers. */
  let exact = $state<CatalogueEntry | null>(null);
  /** True while the add form is open. */
  let showForm = $state(false);
  /** True while the paste-a-lesson panel is open. */
  let showPaste = $state(false);
  /** The add form's fields. */
  let form = $state<NewWordForm>({ ...EMPTY_FORM });
  /** The key of the word whose edit form is open, or null when none is. */
  let editing = $state<WordKey | null>(null);
  /** The edit form's fields, filled from the word when editing starts. */
  let editForm = $state<WordForm>({ ...EMPTY_FORM });
  /** The paste panel: the lines themselves, and what to call the lesson. */
  let paste = $state({ text: '', label: '' });
  /** What just happened, said above the list; `''` when nothing has. */
  let notice = $state('');
  /** True while a write is in flight, which disables the submit buttons. */
  let busy = $state(false);
  /** The warning shown before a word that cannot be asked is saved; `''` when
   *  there is none outstanding. */
  let warning = $state('');
  /** Which words can be heard right now, keyed by word key: a recording, or a
   *  clip on this device that still matches the word. What puts the speaker
   *  button on a row. */
  let playable = $state<Record<WordKey, boolean>>({});
  /* A promoted word takes the catalogue's gender and IPA, which your own record
     does not carry, with your corrections over the top. Without this the list
     showed a gender the card did not. */
  /** Each of your words as the study screens see it, keyed by word key. */
  let shown = $state<Record<WordKey, StudyWord>>({});
  /** What the voice cost on this device, as it was measured from its own clips.
   *  Empty where none have been made. */
  let timings = $state<TimingRow[]>([]);
  /** What the one-time model load cost, by voice. */
  let loads = $state<Awaited<ReturnType<typeof loadTimes>>>({});

  onMount(refresh);

  /** Read everything this screen shows, from scratch: your words, the cards
   *  behind them, how each resolves on a card, and what can be heard now.
   *  Called after every change rather than patching, so the list can never
   *  disagree with the database. */
  async function refresh(): Promise<void> {
    const [words, all] = await Promise.all([activeUserWords(), allCards()]);
    mine = sortForList(words);
    cards = all;
    const byKey = new Map(mine.map((w) => [w.k, w]));
    const resolved: Record<WordKey, StudyWord> = {};
    const next: Record<WordKey, boolean> = {};
    for (const w of mine) {
      const word = (await anyWord(w.k, byKey).catch(() => null)) ?? toStudyWord(w);
      resolved[w.k] = word;
      next[w.k] = !!(await srcFor(word, 'fr'));
    }
    shown = resolved;
    playable = next;
    await measure();
  }

  /** How a word reads on a card: the resolved record where there is one, and
   *  what was typed where the resolution has not landed yet. */
  const asCard = (w: UserWord): StudyWord => shown[w.k] ?? toStudyWord(w);

  /** Read back what the voice has cost here, into `timings` and `loads`. */
  async function measure(): Promise<void> {
    /* The voice is timed on its own clips: the download and start-up once, the
       synthesis of every word after that. */
    const [clips, times] = await Promise.all([allClips(), loadTimes()]);
    timings = summariseTimings(clips, 'fr');
    loads = times;
  }

  /** Play a word, in whichever of its recordings is asked for. Silence is the
   *  answer where there is nothing to play; nothing is said about it, because
   *  the button only appears where there is. */
  async function hear(w: UserWord, kind: 'fr' | 'native' | 'en'): Promise<void> {
    const src = await srcFor(asCard(w), kind);
    if (src) new Audio(src).play().catch(() => {});
  }

  /* The ones promoted out of the catalogue have recordings already. */
  /** The words the voice can work on: your own, as the study screens take
   *  them. */
  let voiceable = $derived(mine.filter((w) => w.source !== 'catalogue').map(toStudyWord));

  /** Which keystroke's search is the current one. An older search that comes
   *  back late is dropped rather than overwriting a newer one's hits. */
  let searchSeq = 0;
  /** Search both lists for what is in the box: the catalogue, for words to add,
   *  and — through `shownList` — your own, which the same text narrows. */
  async function onQuery(): Promise<void> {
    const q = query.trim();
    const seq = ++searchSeq;
    if (!q) {
      hits = [];
      exact = null;
      return;
    }
    const [h, e] = await Promise.all([search(q, 8), findInCatalogue(q)]);
    if (seq !== searchSeq) return; /* a newer keystroke won */
    hits = h;
    exact = e;
  }

  /** Whether a key is already among your own words. */
  const inList = (k: WordKey): boolean => mine.some((w) => w.k === k);

  /* The same box searches both: your own words, which it narrows the list to,
     and the catalogue, which it offers to add from. A catalogue word already in
     your list is left out of the hits — it is in the list below, where every
     action it has lives. */
  /** True while there is something in the search box. */
  let filtering = $derived(!!query.trim());
  /** Your own words as the list renders them: narrowed by the box when there
   *  is something in it, all of them when there is not. */
  let shownList = $derived(filtering ? matchWords(mine, query) : mine);
  /** The catalogue hits worth offering: the ones not already in your list. */
  let offered = $derived(hits.filter((h) => !inList(h.k)));

  /** Add a catalogue word to your list, which brings its recordings and its
   *  verb table with it, and say which of the three things happened: it was
   *  already yours, it was promoted, or it is simply next. */
  async function promote(hit: CatalogueEntry): Promise<void> {
    busy = true;
    try {
      const res = await addWord({ fr: hit.fr, en: hit.en });
      notice = res.known
        ? `${hit.fr} was already among your cards; it keeps its history and goes first in the next sitting.`
        : res.promoted
          ? `${hit.fr} is up next, with its audio.`
          : `${hit.fr} is up next.`;
      query = '';
      hits = [];
      exact = null;
      await refresh();
    } finally {
      busy = false;
    }
  }

  /** Open the add form on whatever is in the search box. `own` is set when the
   *  catalogue already has the word and you want yours anyway. */
  function startNew(own = false): void {
    form = { ...EMPTY_FORM, fr: query.trim(), own };
    warning = '';
    showForm = true;
  }

  /** A word with no English cannot be asked in either direction, so it is said
   *  once before it is saved. Pressing again saves it anyway: half a word
   *  written down beats a word forgotten, and the list flags it afterwards. */
  function guard(rec: WordRecord): boolean {
    const missing = missingFields(rec);
    if (!missing.length || warning) {
      warning = '';
      return true;
    }
    warning =
      `No ${listFields(missing)} yet — this card cannot be asked until it ` +
      'has one. Save it anyway?';
    return false;
  }

  /** The English field split into separate translations. Commas, semicolons
   *  and middots all separate, because all three get typed. */
  const parseEn = (text: string): string[] => text.split(/\s*[,;·]\s*/).filter(Boolean);

  /** Save the add form. Gender and number are only written for a noun, so a
   *  verb cannot keep a gender chosen before the part of speech was changed. */
  async function submitNew(): Promise<void> {
    if (!form.fr.trim()) return;
    const en = parseEn(form.en);
    if (!guard({ fr: form.fr, en })) return;
    busy = true;
    try {
      const res = await addWord({
        ...form,
        en,
        gender: form.pos === 'noun' ? form.gender : '',
        number: form.pos === 'noun' ? form.number : '',
      });
      notice = res.known
        ? `${res.record.fr} was already among your cards; it keeps its history and goes first in the next sitting.`
        : res.promoted
          ? `${res.record.fr} was already in the catalogue, so it is promoted with its audio.`
          : `${res.record.fr} added; it is up next.`;
      showForm = false;
      warning = '';
      query = '';
      hits = [];
      exact = null;
      await refresh();
    } finally {
      busy = false;
    }
  }

  /** Save a pasted lesson: every line becomes a word, the ones the catalogue
   *  knows arrive with their audio, and the count of each is reported. */
  async function submitPaste(): Promise<void> {
    if (!paste.text.trim()) return;
    busy = true;
    try {
      const added = await addLessonText(paste.text, paste.label.trim());
      const promoted = added.filter((a) => a.promoted).length;
      const short = added.filter((a) => isIncomplete(a.record)).length;
      notice =
        `${added.length} words added, ${promoted} of them from the catalogue with audio.` +
        (short ? ` ${short} still need an English translation.` : '');
      paste = { text: '', label: '' };
      showPaste = false;
      await refresh();
    } finally {
      busy = false;
    }
  }

  /** Remove a word from your list. A tombstone travels to the other devices,
   *  which is why the list is read back rather than spliced. */
  async function drop(w: UserWord): Promise<void> {
    await removeWord(w.k);
    await refresh();
  }

  /** Open the edit form on one word, filled from the record as it stands. */
  function startEdit(w: UserWord): void {
    /* Correcting a word keeps its key, so its cards and reviews stay attached:
       fixing "une erreur" to "l'erreur" is a spelling change, not a new word. */
    editing = w.k;
    warning = '';
    editForm = {
      fr: w.fr,
      en: gloss(w, 10),
      pos: w.pos || 'other',
      gender: w.gender || '',
      number: w.number || '',
      note: w.note || '',
    };
  }

  /** Save the edit form onto the word being edited. Nothing it earned moves:
   *  the key stays as it was, so the cards and the log stay attached. */
  async function submitEdit(): Promise<void> {
    if (!editing || !editForm.fr.trim()) return;
    const en = parseEn(editForm.en);
    if (!guard({ fr: editForm.fr, en })) return;
    busy = true;
    try {
      const rec = await editWord(editing, {
        ...editForm,
        en,
        gender: editForm.pos === 'noun' ? editForm.gender : '',
        number: editForm.pos === 'noun' ? editForm.number : '',
      });
      notice = rec ? `${toStudyWord(rec).fr} updated; its history is untouched.` : '';
      editing = null;
      warning = '';
      await refresh();
    } finally {
      busy = false;
    }
  }

  /** A word's translations on one line, middot-separated, at most `n` of them.
   *  Takes either a record's list or a form field's single string, so the same
   *  line serves the list and the edit box. */
  const gloss = (w: { en: string | string[] }, n = 3): string =>
    (Array.isArray(w.en) ? w.en : [w.en]).filter(Boolean).slice(0, n).join(' · ');
</script>

<p class="muted small">
  Anything from a lesson or the street. A word the catalogue already has is simply moved to the
  front, audio and all; a new one is studied from what you type. Either way it comes before the
  mined words in the next sitting.
</p>

<section class="panel">
  <input
    type="text"
    bind:value={query}
    oninput={onQuery}
    placeholder="French or English…"
    autocomplete="off"
    autocapitalize="none"
    spellcheck="false"
  />
  {#if offered.length}
    <p class="from muted small">From the catalogue</p>
    <ul class="hits">
      {#each offered as h (h.k)}
        <li>
          <span
            ><b><Fr text={h.fr} gender="" /></b>
            <span class="muted">{gloss(h)} · level {h.lvl}</span></span
          >
          <button class="small-btn" onclick={() => promote(h)} disabled={busy}
            ><Plus size={14} /> Add</button
          >
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
    <form
      class="new"
      onsubmit={(e) => {
        e.preventDefault();
        submitNew();
      }}
    >
      <label
        >French <input
          type="text"
          bind:value={form.fr}
          required
          autocapitalize="none"
          placeholder="le natel"
        /></label
      >
      <label
        >English <input
          type="text"
          bind:value={form.en}
          oninput={() => (warning = '')}
          placeholder="mobile phone, cell phone"
        /></label
      >
      <div class="row">
        <label
          >Part of speech
          <select bind:value={form.pos}
            >{#each POS as p}<option value={p}>{p}</option>{/each}</select
          >
        </label>
        {#if form.pos === 'noun'}
          <label
            >Gender
            <select bind:value={form.gender}>
              <option value="">—</option><option value="m">m</option>
              <option value="f">f</option><option value="mf">either</option>
            </select>
          </label>
          <label
            >Number
            <select bind:value={form.number}>
              {#each NUMBERS as n}<option value={n}>{n === 'pl' ? 'plural' : 'singular'}</option
                >{/each}
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
        <button
          type="button"
          onclick={() => {
            showForm = false;
            warning = '';
          }}>Cancel</button
        >
      </div>
    </form>
  {/if}
</section>

<button class="link" onclick={() => (showPaste = !showPaste)}>
  {#if showPaste}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if} Paste a lesson list
</button>
{#if showPaste}
  <section class="panel">
    <form
      onsubmit={(e) => {
        e.preventDefault();
        submitPaste();
      }}
    >
      <label
        >Lesson <input
          type="text"
          bind:value={paste.label}
          placeholder="e.g. 5 Sept, at the market"
        /></label
      >
      <label
        >Words, one per line
        <textarea
          bind:value={paste.text}
          rows="6"
          placeholder={'la caisse = till, checkout\nle rayon = shelf, aisle\nune bonne affaire'}
        ></textarea>
      </label>
      <p class="muted small">
        &ldquo;french = english&rdquo; per line; the English is optional for a word the
        catalogue knows.
      </p>
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
        <tr
          ><th>French words</th><th>Per word</th><th>× real time</th><th>First load</th><th
            >Running on</th
          ></tr
        >
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
      Median of the French clips on this device, timed inside the worker: the first load is the
      model being fetched and started, and is not counted in the per-word figure. Under one
      times real time means the voice speaks faster than the speech it makes.
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
          <form
            class="edit"
            onsubmit={(e) => {
              e.preventDefault();
              submitEdit();
            }}
          >
            <label
              >French <input
                type="text"
                bind:value={editForm.fr}
                required
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
              /></label
            >
            <label
              >English <input
                type="text"
                bind:value={editForm.en}
                placeholder="comma-separated"
                oninput={() => (warning = '')}
              /></label
            >
            <div class="row">
              <label
                >Part of speech
                <select bind:value={editForm.pos}
                  >{#each POS as p}<option value={p}>{p}</option>{/each}</select
                >
              </label>
              {#if editForm.pos === 'noun'}
                <label
                  >Gender
                  <select bind:value={editForm.gender}>
                    <option value="">unknown</option><option value="m">m</option>
                    <option value="f">f</option><option value="mf">either</option>
                  </select>
                </label>
                <label
                  >Number
                  <select bind:value={editForm.number}>
                    {#each NUMBERS as n}<option value={n}
                        >{n === 'pl' ? 'plural' : 'singular'}</option
                      >{/each}
                  </select>
                </label>
              {/if}
            </div>
            <label
              >Note <input
                type="text"
                bind:value={editForm.note}
                placeholder="optional"
              /></label
            >
            {#if warning}<p class="warning"><TriangleAlert size={15} /> {warning}</p>{/if}
            <div class="actions">
              <button
                type="button"
                onclick={() => {
                  editing = null;
                  warning = '';
                }}>Cancel</button
              >
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
                <span class="flag" title="No {listFields(missingFields(w))} yet"
                  ><TriangleAlert size={15} /></span
                >
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
              <button
                class="x"
                onclick={() => startEdit(w)}
                aria-label="Edit {w.fr}"
                title="Edit"><Pencil size={15} /></button
              >
              {#if playable[w.k]}
                <button class="x" onclick={() => hear(w, 'fr')} aria-label="Hear {w.fr}"
                  ><Volume2 size={16} /></button
                >
              {/if}
              <span class="status" class:known={statusOf(w.k, cards) === 'known'}
                >{statusOf(w.k, cards)}</span
              >
              {#if w.lesson}<span class="muted small">{w.lesson}</span>{/if}
              <button class="x" onclick={() => drop(w)} aria-label="Remove {w.fr}"
                ><X size={18} /></button
              >
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
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 0 0 8px;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 14px;
    margin-bottom: 12px;
  }
  input,
  select,
  textarea {
    font: inherit;
    width: 100%;
    padding: 9px 11px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    box-sizing: border-box;
  }
  textarea {
    resize: vertical;
  }
  label {
    display: block;
    font-size: 13px;
    color: var(--muted);
    margin-top: 10px;
  }
  /* The edit form sits inside the word's own row, full width. */
  li form.edit {
    flex: 1;
    width: 100%;
    padding: 4px 0 6px;
  }
  li form.edit .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 12px;
  }
  li form.edit .actions button {
    font: inherit;
    font-weight: 600;
    padding: 9px 14px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }
  li form.edit .actions button.primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  li form.edit p {
    margin: 8px 0 0;
  }
  label input,
  label select,
  label textarea {
    margin-top: 4px;
    color: var(--ink);
    font-size: 15px;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: end;
    flex-wrap: wrap;
  }
  .row label {
    flex: 1;
    min-width: 7em;
  }
  .row button {
    margin-top: 12px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .hits {
    margin-top: 8px;
  }
  li {
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }
  .hits li,
  .word {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .hits li:first-child {
    border-top: none;
  }
  .list li:first-child {
    border-top: none;
  }
  /* A word that cannot be asked yet: first in the list, and marked. */
  .list li.unfinished {
    border-left: 3px solid var(--bad);
    padding-left: 10px;
    margin-left: -13px;
  }
  .flag {
    color: var(--bad);
    display: inline-flex;
    vertical-align: -0.2em;
    margin-right: 4px;
  }
  .fix {
    border: none;
    background: none;
    color: var(--bad);
    font: inherit;
    font-size: 13px;
    padding: 0 0 0 4px;
    cursor: pointer;
    text-decoration: underline;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .status {
    font-size: 12px;
    color: var(--muted);
  }
  .status.known {
    color: var(--good);
  }
  button {
    font: inherit;
    font-weight: 600;
    padding: 9px 14px;
    border-radius: 10px;
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
  button.small-btn {
    padding: 5px 12px;
    font-size: 13px;
  }
  button.link {
    border: none;
    background: none;
    color: var(--accent);
    padding: 6px 0;
    font-weight: 500;
    font-size: 14px;
    display: flex;
    justify-content: flex-start;
  }
  .add-new {
    margin-top: 8px;
  }
  .from {
    margin: 12px 0 0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 11.5px;
  }
  button.x {
    border: none;
    background: none;
    color: var(--muted);
    padding: 4px;
  }
  .warning {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    border: 1px solid var(--warn);
    border-radius: 10px;
    padding: 9px 11px;
    margin: 12px 0 0;
  }
  .timings {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  .timings th {
    text-align: left;
    font-weight: 500;
    color: var(--muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 8px 6px 0;
  }
  .timings td {
    padding: 6px 8px 6px 0;
    border-top: 1px solid var(--line);
  }
  .timings .num {
    font-variant-numeric: tabular-nums;
  }
  button:disabled {
    opacity: 0.6;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 13px;
  }
  .notice {
    font-size: 14px;
    color: var(--good);
  }
</style>
