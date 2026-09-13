<script lang="ts">
  /** A French word with its gender shown the way you asked for it: the article
   *  coloured (feminine red, masculine blue, plural green, either-gender
   *  violet, by default), both halves of "le/la enfant" their own colour,
   *  optionally an underline shape for a colour-blind eye and a plain "(f)"
   *  beside the word. Everything without an article — verbs, adjectives,
   *  phrases — renders as plain text.
   *
   *  What to draw is decided in gender.js; this only turns it into spans. */
  import { describeWord } from '$lib/gender.js';
  import type { PaintedPiece } from '$lib/gender.js';
  import { display } from '$lib/display.svelte.js';
  import type { Gender, GrammaticalNumber } from '$lib/model.js';

  interface Props {
    /** The word as the catalogue shows it, article and all. */
    text?: string | undefined;
    /** Absent where the word has none: a verb, an adjective, a phrase. */
    gender?: Gender | undefined;
    number?: GrammaticalNumber | undefined;
  }

  let { text = '', gender = '', number = '' }: Props = $props();

  let shape = $derived(describeWord(text, { gender, number }, display));
  const styleOf = (p: PaintedPiece): string => [
    p.colour ? `color:${p.colour}` : '',
    p.under ? `text-decoration:underline;text-decoration-style:${p.underStyle}` : '',
    p.under ? `text-decoration-color:${p.under};text-underline-offset:.18em` : '',
  ].filter(Boolean).join(';');
</script>
{#each shape.pieces as piece}<span class="art" style={styleOf(piece)}>{piece.text}</span>{/each}{#if shape.gap}{' '}{/if}{shape.rest}{#if shape.mark}<span class="mark">{shape.mark}</span>{/if}

<style>
  .art { font-weight: inherit; }
  /* The letter cue is a note about the word, not part of it. */
  .mark { font-size: .75em; color: var(--muted); margin-left: .3em; font-weight: 500; }
</style>
