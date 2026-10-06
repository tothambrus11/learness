<script lang="ts">
  /** The popup over a word on the screen (Words.svelte): the word as
   *  written, to hear; then each headword it comes from — the singular, the
   *  infinitive — with its article in its gender's colour, how it is said,
   *  what it means and how the form comes from it, to hear as well. What it
   *  is, is lookup.ts; when it opens and closes, wordpopup.svelte.ts. Drawn
   *  once, by the layout, over everything, so a word inside a scrolling
   *  panel is not clipped by the panel. */
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Fr from './Fr.svelte';
  import { lookUp } from '$lib/lookup.js';
  import type { Sense } from '$lib/lookup.js';
  import { player } from '$lib/player.js';
  import { voices } from '$lib/voicequeue.js';
  import { isMaking, isWaiting } from '$lib/voicestate.svelte.js';
  import { closeWord, leaveWord, stayOpen, wordPopup } from '$lib/wordpopup.svelte.js';
  import type { Phrase } from '$lib/conjspeech.js';

  /** Where the popup's clips are kept: by the text they say. */
  const KEY = 'lookup|word';
  const phraseOf = (text: string): Phrase => ({ key: KEY, slot: text, text });

  let senses = $state<Sense[] | null>(null);
  let trouble = $state('');
  let saying = $state('');
  let box = $state<HTMLElement | null>(null);
  let place = $state({ left: 0, top: 0 });
  let seq = 0;

  /* A new word: look it up, and forget what the last one said. */
  $effect(() => {
    const open = wordPopup.open;
    seq += 1;
    const mine = seq;
    senses = null;
    trouble = '';
    if (!open) return;
    lookUp(open.look).then((found) => { if (mine === seq) senses = found; })
      .catch(() => { if (mine === seq) senses = []; });
  });

  /* Beside the word: below it, or above where the window ends first, and
     never past either side. Measured once drawn, and again as it grows. */
  $effect(() => {
    const open = wordPopup.open;
    if (!open || !box) return;
    void senses;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const gap = 6;
    const below = open.rect.bottom + gap;
    const top = below + h > window.innerHeight - 8 && open.rect.top - gap - h > 8 ? open.rect.top - gap - h : below;
    const left = Math.max(8, Math.min(open.rect.left, window.innerWidth - w - 8));
    place = { left, top };
  });

  async function say(text: string): Promise<void> {
    const phrase = phraseOf(text);
    player.stop();
    trouble = '';
    saying = text;
    voices.prefer(KEY);
    try {
      const heard = await player.play([{ phrase }, { say: text, lang: 'fr-FR' }]);
      if (!heard && saying === text) trouble = player.status.trouble;
    } finally {
      if (saying === text) saying = '';
    }
  }
  const making = (text: string): boolean =>
    isMaking(KEY, text) || (saying === text && isWaiting(KEY, text));

  /* Dismissed by Escape, by a tap anywhere that is not a word or the
     popup, and by the page moving under it. */
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && wordPopup.open) closeWord();
  }
  function onDown(e: PointerEvent): void {
    const t = e.target as Element | null;
    if (!wordPopup.open || t?.closest('.word-popup, .w')) return;
    closeWord();
  }
  function onScroll(e: Event): void {
    if (wordPopup.open && !(e.target instanceof Node && box?.contains(e.target))) closeWord();
  }
</script>

<svelte:window onkeydown={onKey} onpointerdown={onDown} onscrollcapture={onScroll} onresize={closeWord} />

{#if wordPopup.open}
  {@const open = wordPopup.open}
  <div class="word-popup panel" role="dialog" tabindex="-1" aria-label="About {open.text}" bind:this={box}
       style="left:{place.left}px;top:{place.top}px"
       onpointerenter={stayOpen} onpointerleave={leaveWord}>
    <div class="row head">
      <b class="fr" class:making={making(open.text)}>{open.text}</b>
      <button type="button" class="hear" onclick={() => say(open.text)} aria-label="Hear {open.text}"><Volume2 size={15} /></button>
    </div>
    {#if senses === null}
      <p class="muted small">Looking it up…</p>
    {:else if senses.length === 0}
      <p class="muted small">Not in the dictionary.</p>
    {:else}
      <ul>
        {#each senses as s (s.key)}
          <li>
            {#if s.via}<span class="muted tiny via">{s.via}</span>{/if}
            <div class="row">
              <span class="fr base" class:making={making(s.fr)}><Fr text={s.fr} gender={s.gender} number={s.number} /></span>
              {#if s.ipa}<span class="ipa">{s.ipa}</span>{/if}
              {#if s.fr.toLowerCase() !== open.text.toLowerCase()}
                <button type="button" class="hear" onclick={() => say(s.fr)} aria-label="Hear {s.fr}"><Volume2 size={15} /></button>
              {/if}
            </div>
            <span class="small">
              {s.en.join('; ')}{#if s.gender === 'm' || s.gender === 'f'}<span class="muted">{' · '}{s.gender === 'f' ? 'feminine' : 'masculine'}</span>{/if}{#if s.pos && s.pos !== 'noun'}<span class="muted">{' · '}{s.pos}</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if trouble}<p class="error small">{trouble}</p>{/if}
  </div>
{/if}

<style>
  .word-popup { position: fixed; z-index: 60; margin: 0; padding: 10px 12px; min-width: 180px;
                max-width: min(320px, calc(100vw - 16px)); box-sizing: border-box;
                box-shadow: 0 6px 24px rgba(0, 0, 0, .22); }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .head { padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid var(--line); }
  .head b { font-size: 17px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .via { display: block; }
  .base { font-weight: 600; }
  .ipa { color: var(--ipa); font-size: 14px; }
  .hear { padding: 2px 6px; line-height: 1; }
  .making { display: inline-block; }
  p { margin: 0; }
</style>
