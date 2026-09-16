<script lang="ts">
  /** Your own words: the search that reaches both your list and the
   *  catalogue, the two ways of adding, and the list itself. What each row
   *  shows is resolved in wordsview.ts the way the card resolves it — the
   *  list once showed a stored record's gender where the card showed the
   *  corrected one (#22) — and the row and the form are components. This
   *  file is the wiring between them. */
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { search } from '$lib/catalogue.js';
  import { detailHref } from '$lib/worddetail.js';
  import { lookup, shipped } from '$lib/dictionary.js';
  import { allCards } from '$lib/db.js';
  import { activeUserWords, addLessonText, addWord, editWord, findInCatalogue, removeWord,
    userKey } from '$lib/words.js';
  import { PARTS, byPart, isIncomplete, matchWords, partsOf, sortForList } from '$lib/wordform.js';
  import type { Part } from '$lib/wordform.js';
  import { EMPTY_FORM, formOf, fromForm, gloss, rowsFor } from '$lib/wordsview.js';
  import type { WordForm as Form, WordRow as Row } from '$lib/wordsview.js';
  import { loadTimes } from '$lib/tts.js';
  import { allClips } from '$lib/db.js';
  import { duration, summariseTimings } from '$lib/timing.js';
  import { wordSources } from '$lib/audio.js';
  import { speakersHere } from '$lib/engine.js';
  import { player } from '$lib/player.js';
  import { toStudyWord } from '$lib/words.js';
  import Fr from '$lib/components/Fr.svelte';
  import VoiceWork from '$lib/components/VoiceWork.svelte';
  import WordForm from '$lib/components/WordForm.svelte';
  import WordRow from '$lib/components/WordRow.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';

  import type { WordKey } from '$lib/keys.js';
  import type { DictEntry } from '$lib/dictionary.js';
  import type { IndexEntry, UserWord } from '$lib/model.js';
  import type { TimingRow } from '$lib/timing.js';

  let mine = $state<UserWord[]>([]);
  let rows = $state<Row[]>([]);
  let query = $state('');
  let part = $state<Part | null>(null);     /* one part of speech, or every one */
  let hits = $state<IndexEntry[]>([]);
  let found = $state<DictEntry[]>([]);      /* from the dictionary, not the curriculum */
  let dictSize = $state(0);                 /* 0 where this catalogue ships none */
  let exact = $state<IndexEntry | null>(null);
  let showForm = $state(false);
  let showPaste = $state(false);
  /* What the add form opens with: the search box's text, and whether the
     word is to be kept as your own. The form owns it from there. */
  let newForm = $state<Form>({ ...EMPTY_FORM });
  let editing = $state<WordKey | null>(null);   /* the word whose form is open */
  let paste = $state({ text: '', label: '' });
  let notice = $state('');
  let busy = $state(false);
  let timings = $state<TimingRow[]>([]);              /* what the voice cost here */
  let loads = $state<Record<string, { loadMs: number | null; backend: string | null }>>({});

  onMount(refresh);
  onMount(async () => { dictSize = (await shipped())?.words ?? 0; });

  async function refresh(): Promise<void> {
    const [words, cards] = await Promise.all([activeUserWords(), allCards()]);
    mine = sortForList(words);
    rows = await rowsFor(mine, cards);
    await measure();
  }

  /* The voice is timed on its own clips: the download and start-up once, the
     synthesis of every word after that. */
  async function measure(): Promise<void> {
    const [clips, times] = await Promise.all([allClips(), loadTimes()]);
    timings = summariseTimings(clips, 'fr');
    loads = times;
  }

  /* Through the one player, so a recording that will not play is said by the
     device instead, and one that cannot be is said on screen. */
  async function hear(row: Row): Promise<void> {
    const heard = await player.play(wordSources(row.shown, 'fr', await speakersHere()),
      { missing: `Nothing to play for ${row.rec.fr} on this device yet.` });
    if (!heard && player.status.trouble) notice = player.status.trouble;
  }

  /* The words the voice can work on: your own, not the ones promoted out of the
     catalogue, which have recordings already. */
  let voiceable = $derived(mine.filter((w) => w.source !== 'catalogue').map(toStudyWord));

  let searchSeq = 0;
  async function onQuery(): Promise<void> {
    const q = query.trim();
    const seq = ++searchSeq;
    if (!q) { hits = []; found = []; exact = null; return; }
    const [h, e, d] = await Promise.all([search(q, 8), findInCatalogue(q), lookup(q, 6)]);
    if (seq !== searchSeq) return;        /* a newer keystroke won */
    hits = h;
    exact = e;
    found = d;
  }

  const inList = (k: WordKey): boolean => mine.some((w) => w.k === k);

  /* The same box searches both: your own words, which it narrows the list to,
     and the catalogue, which it offers to add from. A catalogue word already in
     your list is left out of the hits — it is in the list below, where every
     action it has lives. */
  let filtering = $derived(!!query.trim() || part !== null);
  let shownRows = $derived(filtering
    ? new Set(byPart(matchWords(mine, query), part).map((w) => w.k)) : null);
  /* The chips are the parts your list has, not every part there is (#45);
     a list of one part has nothing to choose between and shows none. */
  let parts = $derived(partsOf(mine));
  const labelOf = (p: Part): string => PARTS.find((x) => x.pos === p)?.label ?? p;
  let listed = $derived(shownRows ? rows.filter((r) => shownRows.has(r.rec.k)) : rows);
  let offered = $derived(hits.filter((h) => !inList(h.k)));
  /* A dictionary word the catalogue also has is the catalogue's to offer — it
     comes with audio and a place in the ranking — and the export leaves those
     out. What is left to hide is one already in your list. */
  let fromDict = $derived(found.filter((d) => !inList(userKey(d.fr, d.pos))));

  function clearSearch(): void {
    query = ''; hits = []; found = []; exact = null;
  }

  /** Add a word from the dictionary: everything the form would have asked for
   *  is already known, so there is nothing to fill in. It is one of your own
   *  words from then on — the catalogue does not teach it, and there is no
   *  recording of it — so the device's voice makes its audio like any other. */
  async function take(entry: DictEntry): Promise<void> {
    busy = true;
    try {
      await addWord({ fr: entry.fr, en: entry.en, pos: entry.pos, gender: entry.gender ?? '',
        ipa: entry.ipa ?? '', own: true });
      notice = `${entry.fr} added from the dictionary; it is up next.`;
      clearSearch();
      await refresh();
    } finally { busy = false; }
  }

  async function promote(hit: IndexEntry): Promise<void> {
    busy = true;
    try {
      const res = await addWord({ fr: hit.fr, en: hit.en });
      notice = res.promoted
        ? `${hit.fr} is up next, with its audio.`
        : `${hit.fr} is up next.`;
      clearSearch();
      await refresh();
    } finally { busy = false; }
  }

  function startNew(own = false): void {
    newForm = { ...EMPTY_FORM, fr: query.trim(), own };
    showForm = true;
  }

  async function submitNew(form: Form): Promise<void> {
    const res = await addWord({ ...fromForm(form), own: form.own ?? false });
    notice = res.promoted
      ? `${res.record.fr} was already in the catalogue, so it is promoted with its audio.`
      : `${res.record.fr} added; it is up next.`;
    showForm = false;
    clearSearch();
    await refresh();
  }

  async function submitPaste(): Promise<void> {
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

  async function drop(w: UserWord): Promise<void> {
    await removeWord(w.k);
    await refresh();
  }

  /* Correcting a word keeps its key, so its cards and reviews stay attached:
     fixing "une erreur" to "l'erreur" is a spelling change, not a new word. */
  async function submitEdit(key: WordKey, form: Form): Promise<void> {
    const rec = await editWord(key, fromForm(form));
    notice = rec ? `${toStudyWord(rec).fr} updated; its history is untouched.` : '';
    editing = null;
    await refresh();
  }
</script>

<p class="muted small">
  Anything from a lesson or the street. A word the catalogue already has is
  simply moved to the front, audio and all;{#if dictSize} one of the
  {dictSize.toLocaleString()} more the dictionary knows arrives with its
  article, its senses and its gender already filled in;{/if} anything else is
  studied from what you type. Either way it comes before the mined words in the
  next sitting.
</p>

<section class="panel">
  <input type="text" bind:value={query} oninput={onQuery} placeholder="French or English…"
         autocomplete="off" autocapitalize="none" spellcheck="false" />
  {#if offered.length}
    <p class="from muted small">From the catalogue</p>
    <ul class="hits">
      {#each offered as h (h.k)}
        <li>
          <span><a class="hit" href={detailHref(base, h.k)}><b><Fr text={h.fr} /></b></a>
            <span class="muted">{gloss(h)} · level {h.lvl}</span></span>
          <button class="small-btn" onclick={() => promote(h)} disabled={busy}><Plus size={14} /> Add</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if fromDict.length}
    <!-- Everything the pipeline glosses but does not teach. Its details are
         filled in from the dictionary rather than typed from memory, which is
         what a word added by hand used to be. -->
    <p class="from muted small">From the dictionary</p>
    <ul class="hits">
      {#each fromDict as d (d.fr + d.pos)}
        <li>
          <span><a class="hit" href={detailHref(base, userKey(d.fr, d.pos))}>
              <b><Fr text={d.fr} gender={d.gender ?? ''} /></b></a>
            <span class="muted">{d.en.join(' · ')} · {d.pos}</span></span>
          <button class="small-btn" onclick={() => take(d)} disabled={busy}>
            <Plus size={14} /> Add
          </button>
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
    <WordForm initial={newForm} action="Add word" onSave={submitNew}
              onCancel={() => (showForm = false)} />
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

{#if timings[0]}
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
      {listed.length} of {mine.length} matching
    {:else}
      {mine.length ? `${mine.length} in your list` : 'Nothing added yet'}
    {/if}
  </h2>
  {#if parts.length > 1}
    <div class="parts" role="group" aria-label="Part of speech">
      <button class="chip" class:primary={part === null} aria-pressed={part === null}
              onclick={() => (part = null)}>All</button>
      {#each parts as p (p)}
        <button class="chip" class:primary={part === p} aria-pressed={part === p}
                onclick={() => (part = part === p ? null : p)}>{labelOf(p)}</button>
      {/each}
    </div>
  {/if}
  {#if filtering && !listed.length && mine.length}
    <p class="muted small">Nothing in your list matches. The catalogue may still have it.</p>
  {/if}
  <ul>
    {#each listed as row (row.rec.k)}
      <li class:unfinished={row.missing.length > 0}>
        {#if editing === row.rec.k}
          <!-- The edit form sits inside the word's own row, full width. -->
          <div class="edit">
            <WordForm initial={formOf(row.rec)} action="Save"
                      onSave={(form) => submitEdit(row.rec.k, form)}
                      onCancel={() => (editing = null)}>
              <p class="muted small">Its cards and history stay attached whatever you change.</p>
            </WordForm>
          </div>
        {:else}
          <WordRow {row} onEdit={() => (editing = row.rec.k)} onHear={() => hear(row)}
                   onRemove={() => drop(row.rec)} onVoiceDone={refresh} />
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  input, textarea { width: 100%; }
  label { display: block; font-size: 13px; color: var(--muted); margin-top: 10px; }
  label input, label textarea { margin-top: 4px; color: var(--ink); font-size: 15px; }
  .edit { padding: 4px 0 6px; }
  .edit p { margin: 8px 0 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  .hits { margin-top: 8px; }
  .hit { color: inherit; text-decoration: none; }
  .hit:hover b, .hit:focus-visible b { text-decoration: underline; text-underline-offset: .15em; }
  li { padding: 8px 0; border-top: 1px solid var(--line); }
  .hits li { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .hits li:first-child { border-top: none; }
  .list li:first-child { border-top: none; }
  /* A word that cannot be asked yet: first in the list, and marked. */
  .list li.unfinished { border-left: 3px solid var(--bad); padding-left: 10px;
                        margin-left: -13px; }
  .parts { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 10px; }
  button.link { display: flex; justify-content: flex-start; }
  .add-new { margin-top: 8px; }
  .from { margin: 12px 0 0; text-transform: uppercase; letter-spacing: .06em; font-size: 11.5px; }
  .timings { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .timings th { text-align: left; font-weight: 500; color: var(--muted); font-size: 12px;
                text-transform: uppercase; letter-spacing: .05em; padding: 0 8px 6px 0; }
  .timings td { padding: 6px 8px 6px 0; border-top: 1px solid var(--line); }
  .timings .num { font-variant-numeric: tabular-nums; }
</style>
