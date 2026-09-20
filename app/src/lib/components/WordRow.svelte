<script lang="ts">
  /** One of your words in the list: as the card shows it, with everything a
   *  word's row can do — correct it, hear it, drop it — and, for a word the
   *  catalogue has no recording of, the voice's own panel. */
  import { base } from '$app/paths';
  import Fr from './Fr.svelte';
  import { detailHref } from '$lib/worddetail.js';
  import VoiceWork from './VoiceWork.svelte';
  import { listFields } from '$lib/wordform.js';
  import { toStudyWord } from '$lib/words.js';
  import { gloss } from '$lib/wordsview.js';
  import type { WordRow } from '$lib/wordsview.js';
  import Pencil from '@lucide/svelte/icons/pencil';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    row: WordRow;
    onEdit: () => void;
    onHear: () => void;
    onRemove: () => void;
    /** A clip was made for this word, so what it can play has changed. */
    onVoiceDone: () => void;
  }

  let { row, onEdit, onHear, onRemove, onVoiceDone }: Props = $props();
  let w = $derived(row.rec);
  let unfinished = $derived(row.missing.length > 0);
</script>

<div class="word give-row">
  <span class="text">
    {#if unfinished}
      <span class="flag" title="No {listFields(row.missing)} yet"><TriangleAlert size={15} /></span>
    {/if}
    <!-- The word is the way to everything about it: its sound, its senses, its
         table, and where each of its cards has got to (#42). -->
    <a class="word-link" href={detailHref(base, w.k)}>
      <b><Fr text={row.shown.fr} gender={row.shown.gender ?? ''} number={row.shown.number ?? ''} /></b>
    </a>
    {#if unfinished}
      <button class="fix" onclick={onEdit}>needs {listFields(row.missing)} — fix this</button>
    {:else}
      <span class="muted">{gloss(w)}</span>
    {/if}
    {#if w.note}<span class="muted small"> · {w.note}</span>{/if}
  </span>
  <span class="controls">
    <button class="x" onclick={onEdit} aria-label="Edit {w.fr}" title="Edit"><Pencil size={15} /></button>
    {#if row.playable}
      <button class="x" onclick={onHear} aria-label="Hear {w.fr}"><Volume2 size={16} /></button>
    {/if}
    <span class="status" class:known={row.status === 'known'}>{row.status}</span>
    <button class="x" onclick={onRemove} aria-label="Remove {w.fr}"><X size={18} /></button>
  </span>
</div>
{#if w.source !== 'catalogue'}
  <VoiceWork words={[toStudyWord(w)]} compact onDone={onVoiceDone} />
{/if}

<style>
  /* The row itself is the .give-row primitive: the text wraps beside the
     controls while it fits, and the controls drop under it when it does not. */
  .word-link { color: inherit; text-decoration: none; }
  .word-link:hover b, .word-link:focus-visible b { text-decoration: underline; text-underline-offset: .15em; }
  .flag { color: var(--bad); display: inline-flex; vertical-align: -.2em; margin-right: 4px; }
  .fix { border: none; background: none; color: var(--bad); font: inherit; font-size: 13px;
         padding: 0 0 0 4px; cursor: pointer; text-decoration: underline; }
  .controls { display: flex; align-items: center; gap: 10px; }
  .status { font-size: 12px; color: var(--muted); }
  .status.known { color: var(--good); }
  button.x { border: none; background: none; color: var(--muted); padding: 4px; }
</style>
