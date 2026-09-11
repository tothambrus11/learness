<script lang="ts">
  /** An info button for one tense, and the popover behind it: what the tense
   *  is for, in English, and a few corpus sentences that use this verb in it.
   *  Hover opens it where hover exists; a tap toggles it everywhere. The
   *  parent decides which one popover is open, so two never fight. */

  import { examplesFor, splitOnForm } from '$lib/examples';
  import { TENSE_NOTES } from '$lib/tenses';
  import type { Conjugation, Example } from '$lib/types';
  import Info from '@lucide/svelte/icons/info';

  /** Which tense of which verb this button stands for, and who decides whether
   *  it is open. */
  interface Props {
    /** The verb's table. Only the infinitive and the sentences filed under it
     *  are read, so a table carrying more than `Conjugation` promises — the
     *  compound tenses, the gaps in an imperative — is welcome here. */
    conj: Pick<Conjugation, 'lemma' | 'examples'>;
    /** The tense, as a group id (`pres`, `subj`) or a compound id (`pc`). An
     *  id with no note of its own falls back to showing the id itself rather
     *  than nothing. */
    tense: string;
    /** True while this popover is the open one. Owned by the parent, so only
     *  one of a table's buttons can be open at a time. */
    open?: boolean;
    /** Ask the parent to make this the open one. */
    onopen?: () => void;
    /** Ask the parent to close whatever is open. */
    onclose?: () => void;
    /** Ids of the tenses whose forms are spelt the same as this one's, used to
     *  explain why the sentences were picked by context — or why there are
     *  none. Empty where the tense is unambiguous. */
    shares?: string[];
    /** Where the popover hangs: `right` from the button itself, `left` below
     *  the nearest positioned ancestor, full width, for a button in a table. */
    align?: 'right' | 'left';
  }

  let {
    conj,
    tense,
    open = false,
    onopen,
    onclose,
    shares = [],
    align = 'right',
  }: Props = $props();

  /** What this tense is for, in English. A tense the notes do not cover still
   *  gets a heading, so the button is never a popover with nothing in it. */
  let note = $derived(TENSE_NOTES[tense] ?? { name: tense, use: '' });
  /** The corpus sentences for this verb in this tense, with the attribution
   *  line they must be shown under. */
  let found = $derived(examplesFor(conj, tense));
  /** True where at least one sentence was matched by what stands before the
   *  verb rather than by spelling, which is worth saying out loud. */
  let byContext = $derived(found.examples.some((e: Example) => e.ctx));
  /** The tenses this one shares its spelling with, named in French rather than
   *  left as ids. */
  let sharedNames = $derived(shares.map((id) => TENSE_NOTES[id]?.name ?? id));
  /** The infinitive, for the sentences that have to name the verb. */
  let lemma = $derived(conj.lemma);

  /** True on a device with a real pointer. A touch browser fakes hover, and a
   *  faked hover opens the popover and then leaves it open. */
  const canHover = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;

  /** How long the popover stays up after the pointer leaves, in milliseconds. */
  const LEAVE_DELAY = 120;

  /** True while a click is holding this popover open, so the pointer leaving
   *  does not close it. Cleared whenever the popover closes. */
  let pinned = $state(false);
  $effect(() => {
    if (!open) pinned = false;
  });
  /** The pending close, so a pointer that leaves and comes straight back does
   *  not make the popover flicker. Undefined before the first leave. */
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** The pointer arriving: open, and call off any close still pending. */
  function enter() {
    if (!canHover()) return;
    clearTimeout(leaveTimer);
    onopen?.();
  }
  /** The pointer leaving: close shortly, unless it was pinned by a click or
   *  the pointer has come back by then. */
  function leave() {
    if (!canHover() || pinned) return;
    leaveTimer = setTimeout(() => {
      if (!pinned) onclose?.();
    }, LEAVE_DELAY);
  }
  /** The button pressed: pin it open, or unpin and close if it was already
   *  pinned. This is the whole interaction on a touch screen. */
  function toggle() {
    clearTimeout(leaveTimer);
    if (open && pinned) {
      pinned = false;
      onclose?.();
    } else {
      pinned = true;
      onopen?.();
    }
  }
</script>

<span
  class="wrap"
  class:static={align === 'left'}
  data-tinfo
  onmouseenter={enter}
  onmouseleave={leave}
  role="presentation"
>
  <button
    type="button"
    class="info"
    class:open
    onclick={toggle}
    aria-expanded={open}
    aria-label="About the {note.name}"
  >
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
  .wrap {
    position: relative;
    display: inline-flex;
    margin-left: auto;
  }
  .info {
    border: none;
    background: none;
    padding: 2px;
    margin: -2px 0;
    color: var(--muted);
    cursor: pointer;
    display: inline-flex;
    border-radius: 6px;
  }
  .info:hover,
  .info.open {
    color: var(--accent);
  }
  .info:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .pop {
    position: absolute;
    right: -6px;
    top: 100%;
    margin-top: 6px;
    z-index: 5;
    width: min(340px, calc(100vw - 48px));
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
    box-shadow: 0 8px 24px -12px rgba(0, 0, 0, 0.35);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    color: var(--ink);
    font-size: 13px;
    line-height: 1.45;
    text-align: left;
    cursor: auto;
    white-space: normal;
  }
  .wrap.static {
    position: static;
  }
  .pop.left {
    right: 0;
    left: 0;
    width: auto;
  }
  .use {
    margin: 0 0 8px;
  }
  .use b {
    font-weight: 650;
  }
  .ex {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ex li {
    display: flex;
    flex-direction: column;
  }
  .fr {
    font-size: 14px;
  }
  mark {
    background: none;
    color: var(--accent);
    font-weight: 650;
  }
  .en {
    color: var(--muted);
    font-size: 12.5px;
  }
  .src {
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--muted);
  }
</style>
