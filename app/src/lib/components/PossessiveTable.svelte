<script lang="ts">
  /** The possessives' table and its notes, as the sheet keeps them beside
   *  the exercises. A row per owner, a column per kind of thing owned, the
   *  columns in the colours the app gives genders everywhere else; the
   *  plural owners' two singular cells drawn as one, because they are one
   *  word. Every cell and every example is a button that says it. What is
   *  in it is possessives.ts; this draws it. */
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Spinner from './Spinner.svelte';
  import { COLUMNS, NOTES, phraseOf, rowsOfSheet } from '$lib/possessives.js';
  import type { Phrase } from '$lib/conjspeech.js';

  interface Props {
    /** Say a phrase. */
    say: (phrase: Phrase) => void;
    /** Whether a phrase is being made or said, for its button. */
    saying: (phrase: Phrase) => boolean;
  }

  let { say, saying }: Props = $props();
  const ROWS = rowsOfSheet();
  const TONE = ['masc', 'fem', 'plur'] as const;
</script>

<table class="sheet">
  <thead>
    <tr>
      <th></th>
      {#each COLUMNS as col, c (c)}
        <th class={TONE[c]}>{col.head}<span class="sub">{col.sub}</span><span class="eg">{col.noun.fr}</span></th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each ROWS as row (row.owner)}
      <tr class:split={row.owner === 3}>
        <th scope="row">{row.fr}<span class="sub">{row.en}</span></th>
        {#each row.cells as cell (cell.column)}
          <td colspan={cell.span} class={cell.span === 2 ? 'both' : TONE[cell.column]}>
            <button type="button" onclick={() => say(cell.heard)} aria-label="Hear {cell.heard.text}"
                    title={cell.heard.text}>
              {#if saying(cell.heard)}<Spinner label="saying it" />{:else}{cell.form}{/if}
            </button>
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>

<ol class="notes">
  {#each NOTES as note, i (i)}
    <li>
      <b>{note.head}</b>
      <span class="muted">{note.body}</span>
      <span class="examples">
        {#each note.examples as text (text)}
          {@const p = phraseOf(text)}
          <button type="button" class="eg-btn" onclick={() => say(p)}>
            {text}
            {#if saying(p)}<Spinner label="saying it" />{:else}<Volume2 size={12} />{/if}
          </button>
        {/each}
      </span>
    </li>
  {/each}
</ol>

<style>
  .sheet { width: 100%; border-collapse: collapse; font-size: 15px; }
  th, td { padding: 2px; text-align: center; }
  thead th { font-size: 13px; font-weight: 600; line-height: 1.2; padding-bottom: 6px; vertical-align: bottom; }
  .sub { display: block; font-size: 11px; font-weight: 400; color: var(--muted); }
  .eg { display: block; font-size: 11px; font-weight: 400; font-style: italic; }
  tbody th { text-align: left; font-weight: 600; line-height: 1.15; padding-right: 6px; white-space: nowrap; }
  tr.split > * { border-top: 1px dashed var(--line); padding-top: 6px; }
  td button { width: 100%; border: 1px solid transparent; border-radius: 8px; padding: 5px 4px;
              font-weight: 600; background: color-mix(in srgb, currentColor 9%, transparent);
              color: inherit; min-height: 34px; }
  td button:hover { border-color: currentColor; }
  .masc { color: var(--masc); }
  .fem { color: var(--fem); }
  .plur { color: var(--plur); }
  .both { color: var(--ink); }
  thead th.masc, thead th.fem, thead th.plur { color: inherit; }
  thead th.masc { border-bottom: 3px solid var(--masc); }
  thead th.fem { border-bottom: 3px solid var(--fem); }
  thead th.plur { border-bottom: 3px solid var(--plur); }
  .notes { margin: 14px 0 0; padding-left: 20px; display: grid; gap: 10px; font-size: 13.5px; line-height: 1.4; }
  .notes li > * { display: block; }
  .examples { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .eg-btn { font-size: 12.5px; padding: 2px 8px; border-radius: 999px; font-weight: 500;
            display: inline-flex; align-items: center; gap: 4px; }
</style>
