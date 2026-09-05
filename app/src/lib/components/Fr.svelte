<script>
  /** A French word with its article coloured: feminine red, masculine blue,
   *  plural green, and both halves of "le/la enfant" their own colour.
   *  Everything without an article — verbs, adjectives, phrases — renders as
   *  plain text. */
  import { articlePieces, splitArticle } from '$lib/gender.js';

  let { text = '', gender = '' } = $props();

  let parts = $derived(splitArticle(text));
  let pieces = $derived(articlePieces(parts.article, gender));
  let elided = $derived(/['’]$/.test(parts.article));
</script>

{#each pieces as piece}<span class="art {piece.kind}">{piece.text}</span>{/each}{#if parts.article && !elided}{' '}{/if}{parts.rest}

<style>
  .art { font-weight: inherit; }
  .m { color: var(--masc); }
  .f { color: var(--fem); }
  .pl { color: var(--plur); }
</style>
