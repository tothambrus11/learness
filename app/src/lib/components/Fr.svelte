<script lang="ts">
  /** A French word with its gender shown the way the display settings ask for
   *  it. `describeWord` decides what to draw — a word with no article renders
   *  as plain text — and this turns the pieces it returns into spans. */

  import { display } from '$lib/display.svelte';
  import { describeWord } from '$lib/gender';
  import type { WordShapePiece } from '$lib/gender';

  /** The word, and the two facts about it the spelling cannot settle alone. */
  interface Props {
    /** The word as it is stored, article and all: "la source", "l'eau",
     *  "être". Empty renders nothing. */
    text?: string;
    /** `m` | `f` | `mf` | `''`. Only consulted where the article is elided or
     *  missing, since "la source" already says which it is. */
    gender?: string;
    /** `pl` where the word is taught in the plural ("les gens"), else `''`. */
    number?: string;
  }

  let { text = '', gender = '', number = '' }: Props = $props();

  /** What to draw, recomputed whenever the word or the display dials change. */
  let shape = $derived(describeWord(text, { gender, number }, display));
  /** One piece's inline style: its colour, and the underline that carries a
   *  second cue where one is wanted. Empty where nothing is to be painted, so
   *  a word with no article gets no attribute at all. */
  const styleOf = (p: WordShapePiece): string =>
    [
      p.colour ? `color:${p.colour}` : '',
      p.under ? `text-decoration:underline;text-decoration-style:${p.underStyle}` : '',
      p.under ? `text-decoration-color:${p.under};text-underline-offset:.18em` : '',
    ]
      .filter(Boolean)
      .join(';');
</script>

{#each shape.pieces as piece}<span class="art" style={styleOf(piece)}>{piece.text}</span
  >{/each}{#if shape.gap}{' '}{/if}{shape.rest}{#if shape.mark}<span class="mark"
    >{shape.mark}</span
  >{/if}

<style>
  .art {
    font-weight: inherit;
  }
  .mark {
    font-size: 0.75em;
    color: var(--muted);
    margin-left: 0.3em;
    font-weight: 500;
  }
</style>
