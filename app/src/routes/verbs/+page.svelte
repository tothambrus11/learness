<script lang="ts">
  /* Eighteen essential verbs: the present and the past participle, to read,
     to hear, and to practise. A sheet beside the course, not part of it —
     nothing here is a card or is written to the database. The verbs are
     lib/verbs18.ts and the workbook lib/verbs18book.ts; this page draws
     them. Every line of a table is a button that says it in the on-device
     voice, made once and kept, or the browser's own French where the device
     has not got that voice. */
  import { onDestroy, onMount } from 'svelte';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Shuffle from '@lucide/svelte/icons/shuffle';
  import Spinner from '$lib/components/Spinner.svelte';
  import VerbExercise from '$lib/components/VerbExercise.svelte';
  import { player } from '$lib/player.js';
  import { eagerAllowed, voices } from '$lib/voicequeue.js';
  import { VERBS, perfect, phrasesOfVerb, withPronoun } from '$lib/verbs18.js';
  import type { Person, Verb } from '$lib/verbs18.js';
  import { PAGE, exercise, page } from '$lib/verbs18book.js';
  import type { Exercise } from '$lib/verbs18book.js';
  import type { Phrase } from '$lib/conjspeech.js';

  const PHRASES = new Map(VERBS.map((v) => [v.inf, phrasesOfVerb(v)]));
  const phrasesOf = (verb: Verb): ReturnType<typeof phrasesOfVerb> => PHRASES.get(verb.inf)!;

  let view = $state<'verbs' | 'book'>('verbs');

  /* ------------------------------------------------------------ sound -- */

  /* The phrase being made or played, so its button can say so; the reason
     the last one could not be heard, so a silent tap is not a mystery. */
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

  onMount(async () => {
    /* The sheet is opened to be heard: its lines are made ahead, where the
       learner allows it, so a tap plays rather than waits. */
    if (!(await eagerAllowed())) return;
    const lines: Phrase[] = [];
    for (const p of PHRASES.values()) lines.push(p.inf, ...p.present, p.pp);
    voices.warm(lines);
  });
  onDestroy(() => { seq += 1; player.stop(); });

  /* ---------------------------------------------------------- workbook -- */

  let onlyIrregular = $state(false);
  let seed = $state(Date.now());
  const verbs = (): string[] => (onlyIrregular ? VERBS.filter((v) => v.irregular).map((v) => v.inf) : []);
  let exercises = $state<Exercise[]>(page({ seed: Date.now() }));

  function newPage(): void {
    seed = Date.now();
    exercises = page({ seed, verbs: verbs() });
  }
  function redeal(i: number): void {
    const kind = PAGE[i];
    if (!kind) return;
    seed += 1;
    exercises[i] = exercise(kind, { seed, verbs: verbs() });
  }
</script>

<div>
  <div class="tabs" role="tablist">
    <button role="tab" class="chip" class:on={view === 'verbs'} aria-selected={view === 'verbs'}
            onclick={() => (view = 'verbs')}>The verbs</button>
    <button role="tab" class="chip" class:on={view === 'book'} aria-selected={view === 'book'}
            onclick={() => (view = 'book')}>Exercises</button>
  </div>
  {#if trouble}<p class="error">{trouble}</p>{/if}

  {#if view === 'verbs'}
    <p class="muted small intro">
      Eighteen verbs to know first: the present, with its pronoun, and the past participle as
      the passé composé uses it. Tap any line to hear it. Nothing here is scheduled or counted.
    </p>
    <section class="grid">
      {#each VERBS as verb (verb.inf)}
        {@const p = phrasesOf(verb)}
        <article class="panel verb">
          <header>
            <button type="button" class="line inf" onclick={() => say(p.inf)} aria-label="Hear {verb.inf}">
              <b>{verb.inf}</b>
              {#if isSaying(p.inf)}<Spinner label="saying it" />{:else}<Volume2 size={14} />{/if}
            </button>
            <span class="muted small">{verb.en}</span>
          </header>
          <ul>
            {#each verb.present as form, i (i)}
              {@const line = p.present[i]!}
              <li>
                <button type="button" class="line" onclick={() => say(line)}>
                  <span>{withPronoun(i as Person, form)}</span>
                  {#if isSaying(line)}<Spinner label="saying it" />{/if}
                </button>
              </li>
            {/each}
          </ul>
          <button type="button" class="line pp" onclick={() => say(p.pp)}>
            <span><span class="muted tiny">participle</span> <b>{verb.pp}</b></span>
            <span class="muted small">{perfect(verb)}</span>
            {#if isSaying(p.pp)}<Spinner label="saying it" />{/if}
          </button>
        </article>
      {/each}
    </section>
  {:else}
    <div class="bar">
      <button class="primary" onclick={newPage}><Shuffle size={15} /> New page</button>
      <label class="small opt">
        <input type="checkbox" bind:checked={onlyIrregular} onchange={newPage} /> Only the irregular verbs
      </label>
    </div>
    <p class="muted small intro">
      Fill in a whole exercise, then check it. Spelling counts, accents included.
    </p>
    {#each exercises as ex, i (`${ex.kind}|${i}`)}
      <VerbExercise {ex} n={i + 1} {say} saying={isSaying} redeal={() => redeal(i)} />
    {/each}
    <button class="primary" onclick={newPage}><Shuffle size={15} /> New page</button>
  {/if}
</div>

<style>
  .tabs { display: flex; gap: 6px; margin-bottom: 12px; }
  button.chip.on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .intro { margin: 0 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
  .verb { padding: 10px; margin: 0; }
  .verb header { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
  .verb ul { list-style: none; margin: 0 0 6px; padding: 0; }
  button.line { display: flex; width: 100%; justify-content: flex-start; gap: 8px; border: none;
                background: none; padding: 3px 6px; border-radius: 8px; font-weight: 400;
                color: var(--ink); text-align: left; }
  button.line:hover { background: var(--bg); }
  button.inf { font-size: 17px; color: var(--accent); }
  button.pp { flex-wrap: wrap; border-top: 1px solid var(--line); border-radius: 0 0 8px 8px;
              padding-top: 6px; }
  .bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .opt { display: flex; align-items: center; gap: 8px; }
</style>
