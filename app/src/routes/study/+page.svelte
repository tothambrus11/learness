<script lang="ts">
  /** One sitting. Each card shows the exercise for the rung its word has
   *  reached: recognise it, say it and check, write it, hear it for meaning,
   *  write down what was said. The card behaves the same way throughout —
   *  prompt, reveal, grade, look back — only what it asks changes.
   *
   *  Three things own this screen, and none of them is this file. The queue,
   *  the position and the answers are `Sitting` (lib/sitting.svelte.ts),
   *  which is tested against the real database. What is *on* the card is
   *  StudyCard's business, read off `face()`. Which key does what is the
   *  shortcut table. What is left here is the wiring: the sound, the focus,
   *  the title bar, the flashes that say what an answer did, and the popup
   *  that corrects the word on the card (#59).
   */
  import { onDestroy, onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { ratingFor } from '$lib/check.js';
  import { setChrome } from '$lib/chrome.svelte.js';
  import { report } from '$lib/diagnostics.js';
  import { choiceFor, phraseFor, sayAloud, tenseFor } from '$lib/cardface.js';
  import { rungOf, wordOf } from '$lib/queue.js';
  import { CHOSEN, HEARD_FIRST, PHRASED, RUNG_LABEL } from '$lib/keys.js';
  import { GRADE_OF, OPTION_OF, pressOf, resolve as shortcutFor } from '$lib/shortcuts.js';
  import type { KeyContext, ShortcutId } from '$lib/shortcuts.js';
  import { Sitting } from '$lib/sitting.svelte.js';
  import { OPEN_BY_DEFAULT, rememberSection, sectionsOf } from '$lib/sections.js';
  import type { Grade } from '$lib/scheduler.js';
  import { NO_SPEAKERS, engineFor, speakersHere } from '$lib/engine.js';
  import type { Speakers } from '$lib/engine.js';
  import { player } from '$lib/player.js';
  import type { PlayerStatus } from '$lib/player.js';
  import Kbd from '$lib/components/Kbd.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import StudyCard from '$lib/components/StudyCard.svelte';
  import WordForm from '$lib/components/WordForm.svelte';
  import { correctWord } from '$lib/words.js';
  import { formOf, fromForm } from '$lib/wordsview.js';
  import type { WordForm as Form } from '$lib/wordsview.js';
  import { prefetchMedia } from '$lib/prefetch.js';
  import { voices, warmSitting } from '$lib/voicequeue.js';
  import { isMaking, made } from '$lib/voicestate.svelte.js';
  import { WORD_SLOT } from '$lib/tts.js';
  import { canSayFrench, sentenceSources, srcFor, wordSources } from '$lib/audio.js';
  import type { CardAudio, Sound } from '$lib/audio.js';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ear from '@lucide/svelte/icons/ear';
  import Mic from '@lucide/svelte/icons/mic';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import Pencil from '@lucide/svelte/icons/pencil';

  const sitting = new Sitting();

  /* The fold-away sections, as the learner last left them — on any screen,
     in any sitting (#64). Read once the sitting is up; written on every
     press of a chevron, from wherever the press came. */
  let showForms = $state(OPEN_BY_DEFAULT.forms);
  let showDefs = $state(OPEN_BY_DEFAULT.defs);
  let sectionsRead = $state(false);
  let editing = $state(false);       /* the popup correcting the live card's word */
  let notice = $state('');
  let input = $state<HTMLInputElement | null>(null);
  let stopPrefetch: () => void = () => {};
  onDestroy(() => { sitting.stop(); stopPrefetch(); player.stop(); voices.clear(); });

  onMount(async () => {
    /* Whether the device can say French decides whether an exercise that is
       heard is dealt at all, so the voices are asked before the sitting is. */
    const heard = await speakersHere().catch(() => NO_SPEAKERS);
    await sitting.start({ hear: engineFor(heard, 'form') !== 'none' });
    if (sitting.error) return;
    if (sitting.settings) {
      const open = sectionsOf(sitting.settings);
      showDefs = open.defs;
      showForms = open.forms;
    }
    sectionsRead = true;
    const ahead = sitting.items.slice(sitting.i);
    stopPrefetch = prefetchMedia(ahead.map((it) => wordOf(it)).filter((w) => !!w)
      .map((w) => w.audio || w.native)).stop;
    /* What the cards ahead will say, made before they are asked for, in the
       order they come — where the learner has asked for that: a sentence
       that has to be made first takes a second and a half, and a second and
       a half after the flip is not the flip. */
    void warmSitting(ahead);
    queueMicrotask(cueLive);
  });

  /* A chevron pressed — on the card, or from the keyboard — is written down
     for the next sitting. Not before the stored state has been read: the
     defaults would overwrite it. */
  $effect(() => {
    const open = showDefs;
    if (sectionsRead) void rememberSection('defs', open);
  });
  $effect(() => {
    const open = showForms;
    if (sectionsRead) void rememberSection('forms', open);
  });

  /* What the title bar says while a sitting is on: where you are in it, and
     how far there is to go. */
  $effect(() => {
    if (sitting.loading || sitting.error) return;
    setChrome({
      title: 'Study',
      subtitle: sitting.finished ? ''
        : `${sitting.left} left${sitting.done.answered ? ` · ${sitting.done.answered} done today` : ''}`,
      progress: sitting.items.length ? Math.min(sitting.i, sitting.items.length) / sitting.items.length : null,
    });
  });

  /* What this card can play: files for catalogue words, clips made on this
     device for your own. Resolved once per card. */
  let has = $state({ fr: false, native: false, en: false });
  let mediaSeq = $state(0);          /* bumped when a clip is made, to look again */
  /* A clip of the word on screen arrived — from the backlog, from the card's
     own Make audio — so the card looks again at what it can play. It used to
     be told by the button; now nobody need press one. */
  $effect(() => {
    void made.seq;
    const key = made.key;
    if (key && untrack(() => wordOf(sitting.shown)?.k) === key) mediaSeq += 1;
  });
  $effect(() => {
    const w = wordOf(sitting.shown);
    void mediaSeq;             /* read, so making a clip means looking again */
    has = { fr: false, native: false, en: false };
    if (!w) return;
    Promise.all([srcFor(w, 'fr'), srcFor(w, 'en')]).then(([fr, en]) => {
      if (wordOf(sitting.shown) === w) has = { fr: !!fr, native: !!w.native, en: !!en };
    });
  });

  /* The word on screen is the one about to be pointed at, so whatever is
     waiting to be said for it goes to the front of the voice's queue — an
     exercise's phrase under the grammar's key, likewise. */
  $effect(() => {
    const shown = sitting.shown;
    const key = wordOf(shown)?.k ?? (shown?.kind === 'rule' ? shown.instance.speech?.key : undefined);
    if (key) voices.prefer(key);
  });

  /* What this device can say with — the on-device voice, the browser's own in
     each language — which decides whether a sentence can be spoken at all, and
     what reads a cue the catalogue has no recording of (most of them: the back
     of a listening card had nothing to press until this was asked for). Asked
     again after a clip is made from the card, since making one may have
     fetched the voice: from then on it says everything (#44). */
  let speakers = $state<Speakers>(NO_SPEAKERS);
  /* The browser lists its voices a moment after the page opens — up to a
     second and a half on a cold start — and the first card asked by ear
     used to play before the list came: its sources had no voice in them,
     the recording was missing, and the card said no voice on this device
     could stand in while the speaker button, pressed a moment later, said
     the word (#81). A play waits for the answer instead. */
  let speakersKnown: Promise<Speakers> = Promise.resolve(NO_SPEAKERS);
  $effect(() => {
    void mediaSeq;
    speakersKnown = speakersHere().then((found) => { speakers = found; return found; });
  });

  /** What the player is doing, mirrored so the template can read it. */
  let sound = $state<PlayerStatus>({ phase: 'idle', trouble: '', heardMs: null });
  onMount(() => player.onStatus((status) => { sound = status; }));
  /* Being made: by the play that is waiting on it, or by the queue working
     ahead — the sitting's warm-up, the backlog — on the phrase this card
     plays at the flip, or the word itself on a card about the word alone.
     Either way the text wears the sweep and the button a spinner, so the
     learner sees the moment coming rather than a card that does nothing. */
  let making = $derived.by((): boolean => {
    const shown = sitting.shown;
    const key = wordOf(shown)?.k ?? (shown?.kind === 'rule' ? shown.instance.speech?.key : undefined);
    return sound.phase === 'making' || (!!key && isMaking(key, phraseFor(shown)?.slot ?? WORD_SLOT));
  });

  /** What the card says when nothing could be heard — rather than the console,
   *  which is where a missing recording used to fail (#31). A card about a
   *  sentence or a form has no recording to miss — those are always said by a
   *  voice — so it says which voice it is missing. */
  const MISSING = {
    fr: 'This word’s recording is missing, and no voice on this device could stand in.',
    phrase: 'No voice on this device could say the sentence, so it stays on the page.',
    en: 'No recording of the English for this word, and no voice on this device could read it.',
  };

  /** A word's own recording: 'fr' the prompt, 'native' a human reading it,
   *  'en' the English cue; the device says it itself where the recording is
   *  missing. Every play goes through the one player, which silences whatever
   *  came before and drops anything that arrives after the card has moved on. */
  async function play(kind: Sound = 'fr'): Promise<boolean> {
    const w = wordOf(sitting.shown);
    /* An exercise has no recording: what it says is its phrase. */
    if (!w) return sitting.shown?.kind === 'rule' && kind === 'fr' ? playModel() : false;
    const heard = await speakersKnown;
    if (wordOf(sitting.shown) !== w) return false;     /* the card moved on while waiting */
    return player.play(wordSources(w, kind, heard), { missing: MISSING[kind === 'en' ? 'en' : 'fr'] });
  }

  /** What to compare your answer against, out loud.
   *
   *  On a card about a sentence that is the whole sentence, not the word
   *  alone: the word on its own is not what you just said, and the liaison
   *  and the rhythm around it are half of what the card teaches; on a card
   *  about a form it is the line, pronoun and all. Then the word's own
   *  recording, for a device that can say neither. */
  async function playModel(): Promise<boolean> {
    const item = sitting.shown;
    if (item?.kind === 'rule') {
      const heard = await speakersKnown;
      if (sitting.shown !== item) return false;
      return player.play(sentenceSources(item, heard), { missing: MISSING.phrase });
    }
    if (item?.kind !== 'word' || !PHRASED.has(item.card.rung)) return play();
    const heard = await speakersKnown;
    if (sitting.shown !== item) return false;
    return player.play([...sentenceSources(item, heard), ...wordSources(item.word, 'fr', heard)],
      { missing: MISSING.phrase });
  }

  /** The face of the exercise on screen, or null on a word card. */
  const faceOf = (item: typeof sitting.shown): string | null => (item?.kind === 'rule' ? item.instance.face : null);

  /** This card has a phrase — a sentence, a line of a table — and something
   *  to say it with. */
  let spoken = $derived(engineFor(speakers, 'sentence') !== 'none' && !!phraseFor(sitting.shown));

  /* A grammar exercise has no word to say or cue: the device's voice would
     otherwise offer the French and the English of nothing, and the chips
     and keys with them (seen on the first turned table). */
  let onWord = $derived(!!wordOf(sitting.shown));

  /** The French can be heard: the recording, or a voice here that says it. */
  let canSay = $derived(onWord && canSayFrench(has.fr, speakers));

  /** The English can be heard: a recording of the cue, or a voice here that
   *  will read it. */
  let canCue = $derived(onWord && (has.en || engineFor(speakers, 'cue') !== 'none'));

  /* The English cue, spoken: the clip, or the browser's voice for a word
     without one. */
  async function cue(): Promise<void> {
    if (wordOf(sitting.shown)) await play('en');
  }

  /** Every flip ends in the French, said aloud.
   *
   *  Whatever the card asked, the thing to fix in memory is how the French
   *  sounds, so it is played without being asked for — on a "use it" card the
   *  whole sentence, which is what was tested. The exception is a card whose
   *  question was itself the French being played: it has just been heard, and
   *  the way to hear it again is on the card.
   */
  function playAfterFlip(): void {
    const live = sitting.current;
    /* An exercise plays what it has to say at the flip — the model of one
       said aloud, the answer of a number written (#95) — unless the sound
       was its question, which has been heard. */
    if (live?.kind === 'rule' && (!live.instance.speech || live.instance.face === 'hear')) return;
    const rung = rungOf(live);
    if (rung && HEARD_FIRST.has(rung)) return;
    void playModel().catch(() => {});   /* a card with no sound still flips */
  }

  function reveal(): void {
    if (sitting.reveal()) playAfterFlip();
  }

  function check(): void {
    if (sitting.check()) playAfterFlip();
  }

  /** An option tapped, by finger or by digit. The sitting decides what it
   *  meant; the card turns over only once the right one is found. */
  function pick(option: string): void {
    if (sitting.pick(option)) playAfterFlip();
  }

  /** The options the live card offers, in the order the digits count them. */
  function optionsOf(): string[] {
    const live = sitting.shown;
    const rung = rungOf(live);
    if (rung === 'choose') return choiceFor(live)?.options ?? [];
    if (rung === 'tense') return tenseFor(live)?.options.map((o) => o.tense) ?? [];
    return [];
  }

  /** The card's own question, said again: the French on a card asked by ear,
   *  the English cue on one asked from the English. Never the answer — this is
   *  reachable from inside the answer box, where the card has not been flipped
   *  yet. */
  function replayPrompt(): void {
    const rung = rungOf(sitting.shown);
    if (!rung) { if (faceOf(sitting.shown) === 'hear') void playModel(); return; }
    if (HEARD_FIRST.has(rung)) void play();
    else if (sitting.shownRevealed) void playModel();
    else void cue();
  }

  /** An answer that could not be written is said on the screen, from the
   *  screen that found out, and written down for the bug button: the card
   *  used to stay where it was and the console alone knew why (#31). */
  function couldNotSave(what: string, err: unknown): void {
    const why = (err as Error).message || String(err);
    flash(`${what} could not be saved: ${why}`);
    report('study', `${what} could not be saved: ${why}`);
  }

  /** Move on from a checked exercise: the cells were the grade. */
  async function next(): Promise<void> {
    player.stop();
    try {
      if (await sitting.next()) queueMicrotask(cueLive);
    } catch (err) {
      couldNotSave('The exercise', err);
    }
  }

  async function record(rating: Grade): Promise<void> {
    /* Whatever is still being made or played was about this card. */
    player.stop();
    let res: Awaited<ReturnType<typeof sitting.record>>;
    try {
      res = await sitting.record(rating);
    } catch (err) {
      couldNotSave('The answer', err);
      return;
    }
    if (!res) return;
    if (res.promoted) flash(`Moved up: ${RUNG_LABEL[res.promoted]}`);
    if (res.heardOpened) flash('You said it, so now you will hear it too');
    if (res.formOpened) flash('You know the verb, so now come its forms');
    /* A form that did not come out is said once more before the next card:
       hearing the right one is not the same as having produced it. */
    if (rating === GRADE_OF.again && res.card.rung === 'voice') flash('Say it once more before you go on');
    queueMicrotask(cueLive);
  }

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(text: string): void {
    notice = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { notice = ''; }, 2600);
  }

  /* Cue the live card: focus the box, and play the question on a card whose
     question is a sound. */
  function cueLive(): void {
    const rung = rungOf(sitting.current);
    if (!sitting.current) return;
    if (sitting.typing) input?.focus();
    if ((rung && HEARD_FIRST.has(rung)) || faceOf(sitting.current) === 'hear') void playModel();
  }

  /** Correct the word on the live card, from the popup, and see it on the
   *  card at once: the sitting looks the word up again rather than waiting
   *  for the next open. A word nothing knows any more is said so, not
   *  swallowed. */
  async function saveEdit(form: Form): Promise<void> {
    const live = wordOf(sitting.current);
    if (!live) return;
    const rec = await correctWord(live.k, fromForm(form));
    editing = false;
    if (!rec) { flash('Nothing here knows this word any more, so it could not be corrected.'); return; }
    await sitting.refreshWord(live.k);
    flash('Corrected; its cards and history are untouched.');
  }

  /** Step back one card, further back, or return to the live card. */
  function lookBack(step: number): void {
    const landed = sitting.lookBack(step);
    if (!landed) return;
    /* What was playing was about the card being left. */
    player.stop();
    if (landed === 'live') queueMicrotask(cueLive);
  }

  /** The sitting as the keyboard sees it: which card is on screen, which way
   *  up, and what it can play. Every hint on the screen is drawn from this,
   *  and every keypress is read against it, so the two cannot disagree. */
  let keys = $derived<KeyContext>({
    idle: sitting.loading || sitting.finished || !sitting.shown,
    browsing: sitting.browsing,
    revealed: sitting.shownRevealed,
    rung: rungOf(sitting.shown),
    drill: sitting.shown?.kind === 'rule',
    judged: sitting.judged,
    canOlder: sitting.canOlder,
    has,
    canSay,
    spoken,
    canCue,
    options: optionsOf().length,
    editing,
  });

  /** What each shortcut does. The table says when a key means one of these;
   *  this says what it is. Grades are the four ratings. */
  const ACTION: Record<ShortcutId, () => void> = {
    older: () => lookBack(-1),
    newer: () => lookBack(1),
    continue: () => lookBack(sitting.history.length),
    show: reveal,
    check,
    replay: replayPrompt,
    playModel: () => void playModel(),
    playNative: () => void play('native'),
    cue: () => void cue(),
    again: () => void record(GRADE_OF.again!),
    hard: () => void record(GRADE_OF.hard!),
    good: () => void record(GRADE_OF.good!),
    easy: () => void record(GRADE_OF.easy!),
    pick1: () => pick(optionsOf()[OPTION_OF.pick1!] ?? ''),
    pick2: () => pick(optionsOf()[OPTION_OF.pick2!] ?? ''),
    pick3: () => pick(optionsOf()[OPTION_OF.pick3!] ?? ''),
    pick4: () => pick(optionsOf()[OPTION_OF.pick4!] ?? ''),
    flagSaid: () => sitting.flagSaid(),
    toggleDefs: () => { showDefs = !showDefs; },
    edit: () => { editing = true; },
    next: () => void next(),
  };

  /* The whole sitting from the keyboard, the answer box included: a keypress
     in the box reaches the sitting's letters with Alt held, and Enter is the
     box's own. Which key means what, and when, is shortcuts.ts's business. */
  function onKeyDown(event: KeyboardEvent): void {
    const id = shortcutFor(pressOf(event), keys);
    if (!id) return;
    event.preventDefault();
    ACTION[id]();
  }

  const RATING_NAME = ['', 'Again', 'Hard', 'Good', 'Easy'];

  /** Everything the card can do with sound, in one record it can read without
   *  knowing where any of it comes from. */
  let audio = $derived<CardAudio>({
    has,
    canSay,
    spoken,
    canCue,
    making,
    trouble: sound.trouble,
    play: (kind: Sound = 'fr'): void => { void play(kind); },
    playModel: (): void => { void playModel(); },
    cue: (): void => { void cue(); },
  });
</script>

<svelte:window onkeydown={onKeyDown} />

{#if !sitting.finished && !sitting.loading && sitting.current && sitting.history.length}
  <!-- Both ways, or the bar says only how to go back: while looking back the
       one thing on screen was "space to continue", which jumps to the live
       card, and nothing said the right arrow steps forward one (#53). -->
  <div class="lookback">
    <button class="link" onclick={() => lookBack(-1)} disabled={!sitting.canOlder}
            aria-label="Previous card"><ChevronLeft size={14} /> Previous card <Kbd id="older" {keys} /></button>
    <button class="link" onclick={() => lookBack(1)} disabled={!sitting.browsing}
            aria-label="Next card">Next card <ChevronRight size={14} /> <Kbd id="newer" {keys} /></button>
  </div>
{/if}

{#if sitting.loading}
  <p class="muted">Preparing a session…</p>
{:else if sitting.error}
  <p class="error">{sitting.error}</p>
{:else if sitting.finished}
  {@const done = sitting.done}
  <section class="panel done">
    <h1>{done.answered ? 'Done for now' : 'Nothing due'}</h1>
    {#if done.answered}
      <p class="big">{done.right} / {done.answered} right today</p>
      {#if done.promoted}<p class="good"><ArrowUp size={15} /> {done.promoted} word{done.promoted === 1 ? '' : 's'} moved up a rung</p>{/if}
      {#if done.heard}<p class="good"><Ear size={15} /> {done.heard} now practised by ear too</p>{/if}
      {#if done.learned}<p class="good">{done.learned} words now known</p>{/if}
    {:else}
      <p class="muted">
        Nothing is due and no new words are allowed today. The daily allowance
        is worked out from how much is already due and how well recall has been
        going.
      </p>
    {/if}
    {#if sitting.waiting.length}
      <!-- A learning step not yet due: the card is held, and said to be, so
           an empty queue does not read as a finished day. -->
      <p class="muted">
        {sitting.waiting.length} card{sitting.waiting.length === 1 ? ' comes' : 's come'}
        back in {sitting.backIn} min
      </p>
    {/if}
    <button class="primary" onclick={() => goto(`${base}/`)}>Home</button>
  </section>
{:else if sitting.shown}
  {@const shown = sitting.shown}
  {@const rung = rungOf(shown)}
  {@const browsing = sitting.browsing}
  {@const aid = rung ? sayAloud(rung) : null}
  {#if browsing}
    {@const ago = sitting.history.length - (sitting.back ?? 0)}
    <p class="dir">Looking back · {ago} card{ago === 1 ? '' : 's'} ago</p>
  {/if}
  {#if notice}<p class="notice">{notice}</p>{/if}

  <StudyCard item={shown} revealed={sitting.shownRevealed} typed={sitting.shownTyped}
             verdict={sitting.shownVerdict} picked={sitting.shownPicked}
             cells={sitting.shownCells} parts={sitting.shownParts}
             {audio} {keys} bind:showDefs bind:showForms bind:input
             onTyped={(value) => sitting.type(value)} onCheck={check} onPick={pick}
             onCell={(i, value) => sitting.typeCell(i, value)} onJudge={(ok) => sitting.judge(ok)}>
    {#snippet tools()}
      <!-- The word itself, on the live card only: a card looked back at is
           a record of an answer, and the word is corrected where it is being
           asked. -->
      {#if !browsing && rung}
        <button class="edit" onclick={() => (editing = true)} aria-label="Correct this word"
                title="Correct this word"><Pencil size={16} /><Kbd id="edit" {keys} /></button>
      {/if}
    {/snippet}
    {#snippet aids()}
      <!-- The only things on the card that belong to the sitting rather than
           to the word: what to do now, and a flag on how it went. A card being
           looked back at has neither, since both are about an answer that has
           already been given. -->
      {#if !browsing && sitting.revealed}
      <div class="aids">
        {#if aid && (has.fr || spoken)}
          <!-- What to do, not a second way to do it: the button that plays the
               model is the card's own, in its row of sounds, and a chip here
               for the same thing carried the same key twice (#63). -->
          <p class="say-first"><Mic size={14} /> {aid}</p>
        {/if}
        {#if has.fr}
          <button class="chip flag" class:on={sitting.saidWrong} aria-pressed={sitting.saidWrong}
                  onclick={() => sitting.flagSaid()}>
            <MicOff size={15} /> I said it wrong <Kbd id="flagSaid" {keys} />
          </button>
        {/if}
      </div>
      {/if}
    {/snippet}
  </StudyCard>

  {#if browsing}
    <p class="muted tiny">
      {rung ? RUNG_LABEL[rung] ?? rung : 'Grammar'} · you answered <b>{sitting.past ? RATING_NAME[sitting.past.rating] : ''}</b>
    </p>
    <!-- Only the way back to the live card: stepping older and newer is the
         bar above the card, both ways (#53). This row used to draw Older and
         Newer too, so ← and → each stood beside two buttons at once (#63). -->
    <div class="grades nav">
      <button class="primary" onclick={() => lookBack(sitting.history.length)}>Continue <Kbd id="continue" {keys} /></button>
    </div>
  {:else if !sitting.revealed && rung && CHOSEN.has(rung)}
    <!-- a tap card is answered on the card; nothing to show until it is -->
  {:else if !sitting.revealed && !sitting.typing}
    <button class="primary wide" onclick={reveal}>Show <Kbd id="show" {keys} /></button>
  {:else if sitting.revealed && sitting.drilling}
    <!-- An exercise has no grade to press: its cells were the grade, each
         rule and verb it observed took its own (GRAMMAR.md). -->
    <div class="grades nav">
      <button class="primary" onclick={next} disabled={sitting.grading || !sitting.judged}>Continue <Kbd id="next" {keys} /></button>
    </div>
  {:else if sitting.revealed}
    {@const grading = sitting.grading}
    <div class="grades">
      <button onclick={() => record(1)} class="again" disabled={grading}>Again <Kbd id="again" {keys} /></button>
      <button onclick={() => record(2)} disabled={grading}>Hard <Kbd id="hard" {keys} /></button>
      <button onclick={() => record(3)} disabled={grading}>Good <Kbd id="good" {keys} /></button>
      <button onclick={() => record(4)} class="easy" disabled={grading}>Easy <Kbd id="easy" {keys} /></button>
    </div>
    {#if sitting.shownVerdict}
      <p class="muted tiny">
        Suggested: {['', 'Again', 'Hard', 'Good', 'Good'][ratingFor(sitting.shownVerdict.verdict)]}
      </p>
    {/if}
  {/if}
{/if}

<!-- Over the card, not instead of it: the sitting waits where it is, and
     the corrected word is on the card when the popup closes. Nothing behind
     it fires meanwhile — the keyboard is read against `keys.editing`. -->
<Modal bind:open={editing} title="Correct this word">
  {#if wordOf(sitting.current)}
    <WordForm initial={formOf(wordOf(sitting.current)!)} action="Save" onSave={saveEdit}
              onCancel={() => (editing = false)}>
      <p class="muted small">Its cards and history stay attached whatever you change.</p>
    </WordForm>
  {/if}
</Modal>

<style>
  .lookback { display: flex; justify-content: flex-end; gap: 14px; margin-bottom: 4px; }
  button.edit { border: none; background: none; color: var(--muted); padding: 6px; }
  .lookback button.link { display: inline-flex; align-items: center; gap: 3px; }
  .lookback button.link:disabled { opacity: .4; cursor: default; }
  .dir { color: var(--muted); font-size: 12px; text-transform: uppercase;
         letter-spacing: .07em; margin: 0 0 8px; }
  .aids { display: flex; flex-direction: column; align-items: center; gap: 10px;
          width: 100%; }
  .say-first { display: flex; align-items: center; justify-content: center; gap: 6px;
               flex-wrap: wrap; font-size: 14px; color: var(--ink); margin: 4px 0 0; }
  .notice { background: var(--panel); border: 1px solid var(--good); border-radius: 10px;
            padding: 8px 12px; margin: 0 0 10px; }
  .panel { padding: 22px 18px; margin-bottom: 0; }
  .chip.on { background: var(--warn); color: var(--on-warn); border-color: var(--warn); }
  button.wide { width: 100%; margin-top: 12px; }
  button.link { color: var(--muted); padding: 4px 0; font-weight: 400; font-size: 13px; }
  .grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
            margin-top: 12px; }
  .grades button { padding: 12px 4px; font-size: 13.5px; }
  .grades .again { color: var(--bad); }
  .grades.nav { grid-template-columns: 1fr; }
  .grades .easy { color: var(--good); }
  .done { text-align: center; gap: 10px; }
  .done h1 { font-size: 22px; margin: 0 0 6px; }
  .big { font-size: 26px; font-weight: 650; margin: 0; }
  .good { color: var(--good); font-weight: 600; display: flex; align-items: center;
          justify-content: center; gap: 6px; margin: 4px 0; }
  .tiny { text-align: center; }
</style>
