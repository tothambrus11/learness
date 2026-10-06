<script lang="ts">
  /* The possessives — mon, ma, mes and the rest — as a sheet beside the
     course: a workbook of exercises, with the table kept beside it to look
     at while answering. Nothing here is a card or is written to the
     database. The table and the rule are lib/possessives.ts, the exercises
     lib/possessivesbook.ts; this page lays them out.

     On a wide screen the table sits in a column of its own and stays in
     view while the exercises scroll; on a phone it is a sheet pulled up
     from the bottom, over the exercises, and put away again. Either way it
     can be hidden, to answer from memory. */
  import { onDestroy, onMount } from 'svelte';
  import Shuffle from '@lucide/svelte/icons/shuffle';
  import Table2 from '@lucide/svelte/icons/table-2';
  import X from '@lucide/svelte/icons/x';
  import BookExercise from '$lib/components/BookExercise.svelte';
  import PossessiveTable from '$lib/components/PossessiveTable.svelte';
  import { player } from '$lib/player.js';
  import { eagerAllowed, voices } from '$lib/voicequeue.js';
  import { report } from '$lib/diagnostics.js';
  import { SHEET_KEY, sheetPhrases } from '$lib/possessives.js';
  import { BOOK_KEY, PAGE, exercise, page, pagePhrases } from '$lib/possessivesbook.js';
  import type { Exercise } from '$lib/possessivesbook.js';
  import type { Phrase } from '$lib/conjspeech.js';

  /* ------------------------------------------------------------ sound -- */

  let saying = $state('');
  let trouble = $state('');
  let seq = 0;
  const idOf = (p: Phrase): string => `${p.key}#${p.slot}`;

  async function say(phrase: Phrase): Promise<void> {
    seq += 1;
    const mine = seq;
    player.stop();
    trouble = '';
    saying = idOf(phrase);
    voices.prefer(phrase.key);
    try {
      const heard = await player.play([{ phrase }, { say: phrase.text, lang: 'fr-FR' }]);
      if (!heard && mine === seq) trouble = player.status.trouble;
    } finally {
      if (mine === seq) saying = '';
    }
  }
  const isSaying = (p: Phrase): boolean => saying === idOf(p);

  /* The sheet is opened to be heard, as a card is: the table and the
     page's answers are made as it opens, where the learner allows things
     to be made ahead, and put in front of whatever else the voice has
     waiting — the table first, then the exercises. A tap then plays rather
     than waits (#109). Leaving sends whatever is still waiting to the back,
     behind the next screen's words, where anything prepared on a guess
     belongs. */
  let onPage = true;
  async function prepare(): Promise<void> {
    if (!(await eagerAllowed()) || !onPage) return;
    voices.warm([...sheetPhrases(), ...pagePhrases(exercises)]);
    voices.prefer(BOOK_KEY);
    voices.prefer(SHEET_KEY);
  }
  onMount(() => { void prepare(); });
  onDestroy(() => {
    onPage = false;
    seq += 1;
    player.stop();
    voices.defer(BOOK_KEY);
    voices.defer(SHEET_KEY);
  });

  /* ------------------------------------------------------------ table -- */

  /* Open beside the work on a wide screen, put away on a phone, where it
     would cover what is being answered. Whether it was hidden on a wide
     screen is remembered on this device; it is a convenience, so a browser
     that will not keep it simply starts with the table open. */
  const SIDE = '(min-width: 900px)';
  const KEPT = 'learness.possessives.table';
  let side = $state(false);
  let open = $state(false);

  onMount(() => {
    const query = window.matchMedia(SIDE);
    side = query.matches;
    let hidden = false;
    try { hidden = localStorage.getItem(KEPT) === 'hidden'; } catch { /* not kept: open */ }
    open = side && !hidden;
    const change = (e: MediaQueryListEvent): void => { side = e.matches; if (!side) open = false; };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  });

  function toggle(): void {
    open = !open;
    if (!side) return;
    try { localStorage.setItem(KEPT, open ? 'shown' : 'hidden'); } catch (e) {
      report('possessives', `could not remember the table: ${String(e)}`);
    }
  }

  /* --------------------------------------------------------- workbook -- */

  let seed = $state(Date.now());
  let exercises = $state<Exercise[]>(page(Date.now()));

  function newPage(): void {
    seed = Date.now();
    exercises = page(seed);
    void prepare();
  }
  function redeal(i: number): void {
    const kind = PAGE[i];
    if (!kind) return;
    seed += 1;
    exercises[i] = exercise(kind, seed);
    void prepare();
  }
</script>

<div class="layout" class:open>
  <div class="work">
    <div class="bar">
      <button class="primary" onclick={newPage}><Shuffle size={15} /> New page</button>
      <button class="table-btn" onclick={toggle} aria-expanded={open} aria-controls="possessive-table">
        <Table2 size={15} /> {open ? 'Hide the table' : 'Show the table'}
      </button>
    </div>
    <p class="muted small intro">
      The possessive determiners (<i>adjectifs possessifs</i>) agree in gender and number with the noun
      they precede, not with the possessor. Each exercise practises one aspect of the rule; the later
      ones combine them. Complete an exercise in full before checking it; spelling, including accents,
      is marked.
    </p>
    {#if trouble}<p class="error">{trouble}</p>{/if}
    {#each exercises as ex, i (`${ex.kind}|${i}`)}
      <BookExercise {ex} n={i + 1} {say} saying={isSaying} redeal={() => redeal(i)} />
    {/each}
    <button class="primary" onclick={newPage}><Shuffle size={15} /> New page</button>
  </div>

  {#if open}
    <aside id="possessive-table" class="panel table" aria-label="The possessives">
      <header>
        <h3>Les possessifs</h3>
        <button type="button" class="link" onclick={toggle} aria-label="Hide the table"><X size={18} /></button>
      </header>
      <PossessiveTable {say} saying={isSaying} />
    </aside>
  {/if}
</div>

{#if !open}
  <button class="fab primary" onclick={toggle} aria-label="Show the table"><Table2 size={18} /> Table</button>
{/if}

<style>
  .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .intro { margin: 0 0 12px; }
  .table header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .table h3 { margin: 0; font-size: 16px; }

  /* A phone: the table is a sheet over the bottom of the screen, above the
     tabs, and the button that brings it back floats where a thumb is. */
  /* Its height includes its padding and border: a panel's padding sits
     outside a max-height otherwise, and on a wide screen the last 34 pixels
     of the table were below the window, out of reach of its own scroll
     (#107). */
  .table {
    box-sizing: border-box;
    position: fixed; z-index: 25; left: 8px; right: 8px; margin: 0;
    bottom: calc(var(--tabs) + 8px + env(safe-area-inset-bottom));
    max-height: 62vh; overflow-y: auto; box-shadow: 0 -6px 28px rgba(0, 0, 0, .22);
  }
  .fab {
    position: fixed; z-index: 25; right: 16px;
    bottom: calc(var(--tabs) + 16px + env(safe-area-inset-bottom));
    display: inline-flex; align-items: center; gap: 6px; border-radius: 999px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .2);
  }
  .table-btn { display: none; }
  @media (min-width: 760px) {
    .table { bottom: 8px; }
    .fab { bottom: 16px; }
  }

  /* Wide enough for both: the table is a column of its own, held in view
     under the bar while the exercises scroll past it. */
  @media (min-width: 900px) {
    .layout.open { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 18px; align-items: start; }
    .table {
      position: sticky; top: calc(var(--bar-row) + env(safe-area-inset-top) + 12px);
      left: auto; right: auto; bottom: auto;
      max-height: calc(100dvh - var(--bar-row) - env(safe-area-inset-top) - 24px);
      box-shadow: none; z-index: auto;
    }
    .layout:not(.open) .work { max-width: 640px; margin: 0 auto; }
    .table-btn { display: inline-flex; align-items: center; gap: 6px; }
    .fab { display: none; }
  }
</style>
