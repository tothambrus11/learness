<script lang="ts">
  /* The tenses, and which the learner has opened. A verb's forms are asked
     only in the tenses opened here (GRAMMAR.md): read what a tense is for
     and how it is built, then start it, and the form cards ask it from the
     next sitting. What each row says is `tenseRows` (grammar/gate.ts); the
     worked example beside a lesson is the learner's best-known verb whose
     table has the tense (grammar/screen.ts). This page decides nothing. */
  import { onMount } from 'svelte';
  import { index } from '$lib/catalogue.js';
  import { allAttempts, allCards, allRuleCards, openBits } from '$lib/db.js';
  import { report } from '$lib/diagnostics.js';
  import { closeBit, openBit } from '$lib/grammar/bits.js';
  import { candidateVerbs, drillRows, earnedLine, groupDrills, hasTense, tenseRowsEarned }
    from '$lib/grammar/screen.js';
  import type { DrillRow } from '$lib/grammar/screen.js';
  import { TENSE_NOTES } from '$lib/tenses.js';
  import { anyWord } from '$lib/words.js';
  import Conjugation from '$lib/components/Conjugation.svelte';
  import Fr from '$lib/components/Fr.svelte';
  import type { IndexEntry, StoredCard, StudyWord } from '$lib/model.js';

  let loading = $state(true);
  let error = $state('');
  let rows = $state<ReturnType<typeof tenseRowsEarned>>([]);
  /* The drills: the rules with a table to fill, and what each has earned. */
  let drills = $state<DrillRow[]>([]);
  let readingDrill = $state<string | null>(null);
  let cards = $state<StoredCard[]>([]);
  let idx = $state<IndexEntry[]>([]);
  /* The tense whose lesson is open, and the verb found to show it on. */
  let reading = $state<string | null>(null);
  let example = $state<StudyWord | null>(null);
  let looked = $state(false);

  let open = $derived(rows.filter((r) => r.open).length);

  async function load(): Promise<void> {
    const [bits, c, ix, ruleCards, attempts] = await Promise.all([
      openBits(), allCards(), index().catch(() => []), allRuleCards(), allAttempts(),
    ]);
    rows = tenseRowsEarned(bits, ruleCards, attempts);
    drills = drillRows(bits, ruleCards, attempts);
    cards = c;
    idx = ix;
  }

  onMount(async () => {
    try {
      await load();
    } catch (err) {
      error = (err as Error).message;
      report('grammar', `the tenses could not be read: ${error}`);
    } finally {
      loading = false;
    }
  });

  /** Open a lesson, and find a verb of the learner's to show it on: the
   *  best-known first, until one has the tense. A handful of lookups at
   *  most; a learner with no such verb reads the lesson on its own. */
  async function read(tense: string): Promise<void> {
    if (reading === tense) { reading = null; return; }
    reading = tense;
    example = null;
    looked = false;
    for (const key of candidateVerbs(cards, idx).slice(0, 8)) {
      const w = await anyWord(key);
      if (reading !== tense) return;            /* the learner moved on */
      if (w?.conj && hasTense(w.conj, tense)) { example = w; break; }
    }
    looked = true;
  }

  async function start(rule: string): Promise<void> {
    try {
      await openBit(rule);
      await load();
    } catch (err) {
      error = (err as Error).message;
      report('grammar', `the tense could not be opened: ${error}`);
    }
  }

  async function stop(rule: string): Promise<void> {
    try {
      await closeBit(rule);
      await load();
    } catch (err) {
      error = (err as Error).message;
      report('grammar', `the tense could not be closed: ${error}`);
    }
  }
</script>

{#if loading}
  <p class="muted">Reading the tenses…</p>
{:else}
  {#if error}<p class="error">{error}</p>{/if}
  <section class="panel intro">
    <p>
      A verb's forms are asked only in the tenses you have started here. Read what a
      tense is for and how it is built, then start it: from the next sitting, the
      verbs you know are asked in it.
    </p>
    <p class="muted small">
      {#if open === 0}
        Nothing started yet. The présent is where to begin.
      {:else}
        {open} of {rows.length} started. What a tense builds on is a suggestion, not a lock.
      {/if}
    </p>
  </section>

  <h2>Tenses</h2>
  <ul class="list">
    {#each rows as row (row.tense)}
      {@const note = TENSE_NOTES[row.tense]}
      <li class:open={reading === row.tense} data-tense={row.tense}>
        <div class="row">
          <button class="name" onclick={() => read(row.tense)}
                  aria-expanded={reading === row.tense}>
            <b>{row.name}</b>
            {#if row.open}<span class="tag on">started</span>
            {:else if row.suggested}<span class="tag">next</span>{/if}
            {#if !row.open && row.missing.length}
              <span class="muted tiny">
                builds on {row.missing.map((m) => m.name).join(', ')}, not started
              </span>
            {/if}
            {#if row.open && row.earned}<span class="muted tiny">{row.earned}</span>{/if}
          </button>
          {#if row.open}
            <button class="quiet" onclick={() => stop(row.rule)}>Stop asking</button>
          {:else}
            <button class="primary" onclick={() => start(row.rule)}>Start</button>
          {/if}
        </div>
        {#if reading === row.tense && note}
          <div class="lesson">
            <p>{note.use}</p>
            <p><b>How it is built.</b> {note.formation}</p>
            {#if example?.conj}
              <p class="muted small">
                On a verb you know: <Fr text={example.fr} gender={example.gender ?? ''}
                                        number={example.number ?? ''} />
              </p>
              <Conjugation conj={example.conj} wordKey={example.k} />
            {:else if looked}
              <p class="muted small">
                None of the verbs you know has this tense in its table yet; the table
                on a verb's own page will, once you have met one.
              </p>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  <h2>Drills</h2>
  <p class="muted small">
    A drill is an exercise in the sitting: a table of a verb you know to fill, a
    sentence of it to rewrite, a number to write in words. It is checked cell by
    cell, and a rule is passed once it has come out right on a handful of
    different verbs, sentences or numbers. A tense started above is drilled the
    same way, on its own row.
  </p>
  {#each groupDrills(drills) as group (group.module)}
  <h3>{group.label}</h3>
  <ul class="list">
    {#each group.rows as row (row.rule)}
      <li class:open={readingDrill === row.rule} data-rule={row.rule}>
        <div class="row">
          <button class="name" onclick={() => (readingDrill = readingDrill === row.rule ? null : row.rule)}
                  aria-expanded={readingDrill === row.rule}>
            <b>{row.lesson.name}</b>
            {#if row.passed}<span class="tag on">passed</span>
            {:else if row.open}<span class="tag on">started</span>{/if}
            <span class="muted tiny">{earnedLine(row)}</span>
            {#if !row.open && row.missing.length}
              <span class="muted tiny">builds on {row.missing.join(', ')}, not started</span>
            {/if}
          </button>
          {#if row.open}
            <button class="quiet" onclick={() => stop(row.rule)}>Stop asking</button>
          {:else}
            <button class="primary" onclick={() => start(row.rule)}>Start</button>
          {/if}
        </div>
        {#if readingDrill === row.rule}
          <div class="lesson">
            <p>{row.lesson.use}</p>
            <p><b>How it is built.</b> {row.lesson.formation}</p>
            <p class="fr-example">{row.lesson.example}</p>
            {#if row.lesson.note}<p class="muted small">{row.lesson.note}</p>{/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {/each}
{/if}

<style>
  .intro p { margin: 0 0 8px; }
  .intro p:last-child { margin-bottom: 0; }
  .list { list-style: none; margin: 14px 0 0; padding: 0; background: var(--panel);
          border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  li { border-top: 1px solid var(--line); }
  li:first-child { border-top: none; }
  li.open { background: var(--bg); }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; }
  .name { flex: 1 1 auto; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: flex-start; gap: 6px 8px;
          min-height: 42px; padding: 4px 0; border: none; background: none; color: var(--ink);
          font: inherit; text-align: left; cursor: pointer; }
  .tag { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px;
         padding: 0 6px; }
  .tag.on { color: var(--on-good); background: var(--good); border-color: var(--good); }
  .quiet { color: var(--muted); }
  .lesson { padding: 0 12px 12px; }
  .lesson p { margin: 0 0 10px; }
  .fr-example { font-style: italic; }
  h2 { font-size: 15px; margin: 18px 0 6px; color: var(--muted); font-weight: 600;
       text-transform: uppercase; letter-spacing: .06em; }
  h3 { font-size: 14px; margin: 14px 0 4px; color: var(--muted); font-weight: 600; }
  h2 + .list, h3 + .list { margin-top: 6px; }
</style>
