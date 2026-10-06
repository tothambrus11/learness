<script lang="ts">
  /** A line of French whose every word can be pointed at or tapped to say
   *  what it is: its headword, what that means, its gender and how it is
   *  said, and the word to hear (WordPopup.svelte, from the layout). The
   *  text is drawn exactly as given; only the words are wrapped.
   *
   *  Not for text inside a button or a link — a word there would be a
   *  button inside a button, and a tap could not mean both — and not for
   *  an answer the screen has not shown yet. */
  import { tokens } from '$lib/lexicon.js';
  import { hoverWord, leaveWord, openWord } from '$lib/wordpopup.svelte.js';

  interface Props {
    /** The French, as written. */
    text: string;
  }

  let { text }: Props = $props();
  let parts = $derived(tokens(text));

  function onKey(e: KeyboardEvent, t: string, look: string): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openWord(t, look, e.currentTarget as Element);
  }
</script>

{#each parts as part, i (i)}{#if part.look}{@const look = part.look}<span
    class="w" role="button" tabindex="-1" data-look={look}
    onclick={(e) => openWord(part.text, look, e.currentTarget)}
    onkeydown={(e) => onKey(e, part.text, look)}
    onpointerenter={(e) => { if (e.pointerType === 'mouse') hoverWord(part.text, look, e.currentTarget); }}
    onpointerleave={leaveWord}>{part.text}</span>{:else}{part.text}{/if}{/each}

<style>
  /* A word that has more to say: nothing until pointed at, then a dotted
     line under it, so a page of them does not look like a page of links. */
  .w { cursor: help; border-radius: 3px; }
  .w:hover { text-decoration: underline dotted var(--muted); text-underline-offset: 3px; }
</style>
