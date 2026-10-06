<script lang="ts">
  /** One exercise of a workbook — the verbs', the possessives' — as a page
   *  of a course book sets it: numbered items, all filled in, then checked
   *  together. After the check
   *  every item says whether it was right; a wrong one shows what was typed
   *  and what was wanted with the letters that differ marked on both, and
   *  every item can be heard whole. The answers stay editable, so a mistake
   *  can be put right and checked again. Enter in any box checks — the
   *  form's own submit, not a shortcut — and Tab goes to the next box.
   *  What is right is essentialsbook.ts `mark`; this draws it. */
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Spinner from './Spinner.svelte';
  import { diff, worthMarking } from '$lib/essentials.js';
  import { mark } from '$lib/essentialsbook.js';
  import type { Mark, Workbook } from '$lib/essentialsbook.js';
  import type { Phrase } from '$lib/conjspeech.js';

  interface Props {
    /** The exercise; a new one clears the answers. */
    ex: Workbook;
    /** Its place on the page, for the heading's number. */
    n: number;
    /** Say a phrase; resolves when it has been said or given up. */
    say: (phrase: Phrase) => void;
    /** Whether a phrase is being made or said, for its button. */
    saying: (phrase: Phrase) => boolean;
    /** Ask for this exercise again, dealt afresh. */
    redeal: () => void;
  }

  let { ex, n, say, saying, redeal }: Props = $props();

  let typed = $state<string[]>([]);
  let marks = $state<Mark[] | null>(null);
  let right = $state(0);
  /* A new exercise is a clean page. */
  $effect(() => {
    typed = ex.items.map(() => '');
    marks = null;
  });

  function check(e: SubmitEvent): void {
    e.preventDefault();
    const out = mark(ex, typed);
    marks = out.marks;
    right = out.right;
  }

  function retry(): void {
    if (!marks) return;
    typed = typed.map((t, i) => (marks?.[i]?.state === 'right' ? t : ''));
    marks = null;
  }
</script>

<section class="panel exercise">
  <header>
    <h3><span class="num">{n}</span> {ex.title}</h3>
    <button type="button" class="small-btn" onclick={redeal}><RotateCcw size={13} /> New</button>
  </header>
  <p class="muted small instruction">{ex.instruction}</p>
  <form onsubmit={check}>
    <ol class:wide={ex.items.some((i) => i.wide)}>
      {#each ex.items as item, i (item.id)}
        {@const m = marks?.[i]}
        <li class:right={m?.state === 'right'} class:wrong={m && m.state !== 'right'}>
          {#if item.wide}<p class="cue en">{item.cue}</p>{/if}
          <div class="line" class:wide={item.wide}>
            {#if item.before}<span class="fr">{item.before}</span>{/if}
            <input bind:value={typed[i]} autocomplete="off" autocapitalize="off" spellcheck="false"
                   lang="fr" aria-label="Answer {i + 1}" class:wide={item.wide} />
            {#if item.after && item.gloss}
              <!-- A noun: what it means and its gender over it, on a hover or
                   a tap (#110). Not a tab stop: Tab goes from box to box. -->
              <span class="fr noun">{item.after}<span class="gloss" role="tooltip">{item.gloss}</span></span>
            {:else if item.after}<span class="fr">{item.after}</span>{/if}
            {#if item.cue && !item.wide}<span class="cue muted">({item.cue})</span>{/if}
            {#if m}
              <span class="mark">
                {#if m.state === 'right'}<Check size={16} />{:else}<X size={16} />{/if}
              </span>
              <button type="button" class="link hear" onclick={() => say(item.heard)} aria-label="Hear it">
                {#if saying(item.heard)}<Spinner label="saying it" />{:else}<Volume2 size={15} />{/if}
              </button>
            {/if}
          </div>
          {#if m && m.state === 'wrong' && !worthMarking(m.typed.trim(), m.against)}
            <p class="fix small"><span class="yours">{m.typed.trim()}</span> <span class="muted">→</span>
              <span class="want">{m.against}</span></p>
          {:else if m && m.state === 'wrong'}
            {@const d = diff(m.typed.trim(), m.against)}
            <p class="fix small">
              <span class="yours">{#each d.typed as seg, k (k)}<span class:off={!seg.same}>{seg.text}</span>{/each}</span>
              <span class="muted">→</span>
              <span class="want">{#each d.want as seg, k (k)}<span class:off={!seg.same}>{seg.text}</span>{/each}</span>
            </p>
          {:else if m && m.state === 'empty'}
            <p class="fix small"><span class="want">{m.against}</span></p>
          {/if}
        </li>
      {/each}
    </ol>
    <div class="foot">
      <button class="primary" type="submit">{marks ? 'Check again' : 'Check'}</button>
      {#if marks}
        <b class="score" class:all={right === ex.items.length}>{right} / {ex.items.length}</b>
        {#if right < ex.items.length}
          <button type="button" class="small-btn" onclick={retry}>Clear the wrong ones</button>
        {/if}
      {/if}
    </div>
  </form>
</section>

<style>
  .exercise { margin-bottom: 14px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h3 { margin: 0; font-size: 17px; display: flex; align-items: center; gap: 8px; }
  .num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
         border-radius: 50%; background: var(--accent); color: var(--on-accent); font-size: 13px; }
  .instruction { margin: 4px 0 10px; font-style: italic; }
  ol { margin: 0; padding-left: 24px; display: grid; gap: 8px; }
  li { padding-left: 4px; }
  .line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .line input { width: 6.5em; min-width: 0; padding: 5px 8px; }
  .line input.wide { flex: 1 1 100%; width: auto; }
  .cue.en { margin: 0 0 4px; }
  /* A noun with its meaning and gender over it: dotted, like a word that
     has more to say, and the popup above it while the pointer is there. */
  .noun { position: relative; text-decoration: underline dotted var(--muted); text-underline-offset: 3px;
          cursor: help; }
  .gloss { display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
           z-index: 5; white-space: nowrap; padding: 4px 8px; border-radius: 8px; font-size: 13px;
           background: var(--ink); color: var(--bg); pointer-events: none; }
  .noun:hover .gloss, .noun:active .gloss { display: block; }
  li.right input { border-color: var(--good); }
  li.wrong input { border-color: var(--bad); }
  li.right .mark { color: var(--good); }
  li.wrong .mark { color: var(--bad); }
  .hear { padding: 2px; }
  .fix { margin: 4px 0 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
  .yours { text-decoration: line-through; text-decoration-color: var(--muted); }
  .yours .off { color: var(--bad); background: color-mix(in srgb, var(--bad) 15%, transparent);
                border-radius: 3px; text-decoration: line-through; }
  .want { font-weight: 600; color: var(--good); }
  .want .off { background: color-mix(in srgb, var(--good) 22%, transparent); border-radius: 3px;
               text-decoration: underline; }
  .foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
  .score { font-size: 18px; color: var(--bad); }
  .score.all { color: var(--good); }
</style>
