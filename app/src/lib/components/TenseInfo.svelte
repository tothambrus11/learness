<script>
  /** An info button for one tense, and the popover behind it: what the tense
   *  is for, in English, and a few corpus sentences that use this verb in it.
   *  Hover opens it where hover exists; a tap toggles it everywhere. The
   *  parent decides which one popover is open, so two never fight. */
  import Info from '@lucide/svelte/icons/info';
  import { TENSE_NOTES } from '$lib/tenses.js';
  import { examplesFor, splitOnForm } from '$lib/examples.js';

  /** align: 'right' hangs the popover from the button; 'left' lays it below
   *  the nearest positioned ancestor, full width, for buttons inside a table. */
  let { conj, tense, open = false, onopen, onclose, shares = [], align = 'right' } = $props();

  let note = $derived(TENSE_NOTES[tense] ?? { name: tense, use: '' });
  let found = $derived(examplesFor(conj, tense));
  let byContext = $derived(found.examples.some((e) => e.ctx));
  let sharedNames = $derived(shares.map((id) => TENSE_NOTES[id]?.name ?? id));
  let lemma = $derived(conj.lemma);

  const canHover = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;

  /* Hover opens and the pointer leaving closes; a click pins it open until
     the next click, Escape, or a tap elsewhere. Without the pin, a click on a
     mouse device would close what the hover had just opened. */
  let pinned = $state(false);
  $effect(() => { if (!open) pinned = false; });
  let leaveTimer;
  function enter() {
    if (!canHover()) return;
    clearTimeout(leaveTimer);
    onopen?.();
  }
  function leave() {
    if (!canHover() || pinned) return;
    leaveTimer = setTimeout(() => { if (!pinned) onclose?.(); }, 120);
  }
  function toggle() {
    clearTimeout(leaveTimer);
    if (open && pinned) { pinned = false; onclose?.(); }
    else { pinned = true; onopen?.(); }
  }
</script>

<span class="wrap" class:static={align === 'left'} data-tinfo onmouseenter={enter} onmouseleave={leave} role="presentation">
  <button type="button" class="info" class:open onclick={toggle} aria-expanded={open}
          aria-label="About the {note.name}">
    <Info size={15} />
  </button>
  {#if open}
    <div class="pop" class:left={align === 'left'} role="dialog" aria-label={note.name}>
      <p class="use"><b>{note.name}</b> {note.use}</p>
      {#if found.examples.length}
        <ul class="ex">
          {#each found.examples as ex}
            {@const [a, hit, b] = splitOnForm(ex.fr, ex.f)}
            <li>
              <span class="fr" lang="fr">{a}<mark>{hit}</mark>{b}</span>
              <span class="en">{ex.en}</span>
            </li>
          {/each}
        </ul>
        <p class="src">
          {found.source}.
          {#if byContext}
            The spelling is shared with the {sharedNames.join(' and ')}, so these were picked by
            what stands before the verb.
          {/if}
        </p>
      {:else if sharedNames.length}
        <p class="src">
          No sentence in the corpus pins this tense of <i>{lemma}</i> down: every form is also
          spelt like the {sharedNames.join(' or ')}.
        </p>
      {:else}
        <p class="src">No sentence in the corpus uses this tense of <i>{lemma}</i>.</p>
      {/if}
    </div>
  {/if}
</span>

<style>
  .wrap { position: relative; display: inline-flex; margin-left: auto; }
  .info { border: none; background: none; padding: 2px; margin: -2px 0; color: var(--muted);
          cursor: pointer; display: inline-flex; border-radius: 6px; }
  .info:hover, .info.open { color: var(--accent); }
  .info:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .pop { position: absolute; right: -6px; top: 100%; margin-top: 6px; z-index: 5;
         width: min(340px, calc(100vw - 48px)); background: var(--panel);
         border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
         box-shadow: 0 8px 24px -12px rgba(0, 0, 0, .35);
         text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--ink);
         font-size: 13px; line-height: 1.45; text-align: left; cursor: auto; white-space: normal; }
  .wrap.static { position: static; }
  .pop.left { right: 0; left: 0; width: auto; }
  .use { margin: 0 0 8px; }
  .use b { font-weight: 650; }
  .ex { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .ex li { display: flex; flex-direction: column; }
  .fr { font-size: 14px; }
  mark { background: none; color: var(--accent); font-weight: 650; }
  .en { color: var(--muted); font-size: 12.5px; }
  .src { margin: 8px 0 0; font-size: 11.5px; color: var(--muted); }
</style>
