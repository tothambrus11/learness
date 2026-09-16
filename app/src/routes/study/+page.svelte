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
   *  the title bar, and the flashes that say what an answer did.
   */
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { ratingFor } from '$lib/check.js';
  import { setChrome } from '$lib/chrome.svelte.js';
  import { choiceFor, phraseFor, tenseFor } from '$lib/cardface.js';
  import { CHOSEN, HEARD_FIRST, PHRASED, RUNG_LABEL, SAY_ALOUD } from '$lib/keys.js';
  import { GRADE_OF, OPTION_OF, pressOf, resolve as shortcutFor } from '$lib/shortcuts.js';
  import type { KeyContext, ShortcutId } from '$lib/shortcuts.js';
  import { Sitting } from '$lib/sitting.svelte.js';
  import type { Grade } from '$lib/scheduler.js';
  import { NO_SPEAKERS, engineFor, speakersHere } from '$lib/engine.js';
  import type { Speakers } from '$lib/engine.js';
  import { player } from '$lib/player.js';
  import type { PlayerStatus } from '$lib/player.js';
  import Kbd from '$lib/components/Kbd.svelte';
  import StudyCard from '$lib/components/StudyCard.svelte';
  import { prefetchMedia } from '$lib/prefetch.js';
  import { voices, warmSitting } from '$lib/voicequeue.js';
  import { sentenceSources, srcFor, wordSources } from '$lib/audio.js';
  import type { CardAudio, Sound } from '$lib/audio.js';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ear from '@lucide/svelte/icons/ear';
  import Mic from '@lucide/svelte/icons/mic';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import Volume2 from '@lucide/svelte/icons/volume-2';

  const sitting = new Sitting();

  let showForms = $state(false);     /* stays as you left it for the whole sitting */
  let showDefs = $state(true);       /* the definitions on the back; likewise remembered */
  let notice = $state('');
  let input = $state<HTMLInputElement | null>(null);
  let stopPrefetch: () => void = () => {};
  onDestroy(() => { sitting.stop(); stopPrefetch(); player.stop(); voices.clear(); });

  onMount(async () => {
    await sitting.start();
    if (sitting.error) return;
    const ahead = sitting.items.slice(sitting.i);
    stopPrefetch = prefetchMedia(ahead.map((it) => it.word.audio || it.word.native)).stop;
    /* The verbs in this sitting, said before they are asked for: a form that
       has to be made first takes a second and a half, and a second and a
       half after pointing at something is not an answer to pointing at it. */
    void warmSitting(ahead.map((it) => it.word));
    queueMicrotask(cueLive);
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
  $effect(() => {
    const w = sitting.shown?.word;
    void mediaSeq;             /* read, so making a clip means looking again */
    has = { fr: false, native: false, en: false };
    if (!w) return;
    Promise.all([srcFor(w, 'fr'), srcFor(w, 'en')]).then(([fr, en]) => {
      if (sitting.shown?.word === w) has = { fr: !!fr, native: !!w.native, en: !!en };
    });
  });

  /* The word on screen is the one about to be pointed at, so whatever is
     waiting to be said for it goes to the front of the voice's queue. */
  $effect(() => {
    const key = sitting.shown?.word.k;
    if (key) voices.prefer(key);
  });

  /* What this device can say with — the on-device voice, the browser's own in
     each language — which decides whether a sentence can be spoken at all, and
     what reads a cue the catalogue has no recording of (most of them: the back
     of a listening card had nothing to press until this was asked for). Asked
     again after a clip is made from the card, since making one may have
     fetched the voice: from then on it says everything (#44). */
  let speakers = $state<Speakers>(NO_SPEAKERS);
  $effect(() => {
    void mediaSeq;
    speakersHere().then((found) => { speakers = found; });
  });

  /** What the player is doing, mirrored so the template can read it. */
  let sound = $state<PlayerStatus>({ phase: 'idle', trouble: '' });
  onMount(() => player.onStatus((status) => { sound = status; }));
  let making = $derived(sound.phase === 'making');

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
  function play(kind: Sound = 'fr'): Promise<boolean> {
    const w = sitting.shown?.word;
    if (!w) return Promise.resolve(false);
    return player.play(wordSources(w, kind, speakers), { missing: MISSING[kind === 'en' ? 'en' : 'fr'] });
  }

  /** What to compare your answer against, out loud.
   *
   *  On a card about a sentence that is the whole sentence, not the word
   *  alone: the word on its own is not what you just said, and the liaison
   *  and the rhythm around it are half of what the card teaches; on a card
   *  about a form it is the line, pronoun and all. Then the word's own
   *  recording, for a device that can say neither. */
  function playModel(): Promise<boolean> {
    const item = sitting.shown;
    if (!item || !PHRASED.has(item.card.rung)) return play();
    return player.play([...sentenceSources(item, speakers), ...wordSources(item.word, 'fr', speakers)],
      { missing: MISSING.phrase });
  }

  /** This card has a phrase — a sentence, a line of a table — and something
   *  to say it with. */
  let spoken = $derived(engineFor(speakers, 'sentence') !== 'none' && !!phraseFor(sitting.shown));

  /** The English can be heard: a recording of the cue, or a voice here that
   *  will read it. */
  let canCue = $derived(has.en || engineFor(speakers, 'cue') !== 'none');

  /* The English cue, spoken: the clip, or the browser's voice for a word
     without one. */
  async function cue(): Promise<void> {
    if (sitting.shown?.word) await play('en');
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
    const rung = sitting.current?.card.rung;
    if (!rung || HEARD_FIRST.has(rung)) return;
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
    if (!live) return [];
    if (live.card.rung === 'choose') return choiceFor(live)?.options ?? [];
    if (live.card.rung === 'tense') return tenseFor(live)?.options.map((o) => o.tense) ?? [];
    return [];
  }

  /** The card's own question, said again: the French on a card asked by ear,
   *  the English cue on one asked from the English. Never the answer — this is
   *  reachable from inside the answer box, where the card has not been flipped
   *  yet. */
  function replayPrompt(): void {
    const rung = sitting.shown?.card.rung;
    if (!rung) return;
    if (HEARD_FIRST.has(rung)) void play();
    else if (sitting.shownRevealed) void playModel();
    else void cue();
  }

  async function record(rating: Grade): Promise<void> {
    /* Whatever is still being made or played was about this card. */
    player.stop();
    const res = await sitting.record(rating);
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
    const live = sitting.current;
    if (!live) return;
    if (sitting.typing) input?.focus();
    if (HEARD_FIRST.has(live.card.rung)) void play();
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
    rung: sitting.shown?.card.rung ?? null,
    canOlder: sitting.canOlder,
    has,
    spoken,
    canCue,
    options: optionsOf().length,
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
  {@const rung = shown.card.rung}
  {@const browsing = sitting.browsing}
  {#if browsing}
    {@const ago = sitting.history.length - (sitting.back ?? 0)}
    <p class="dir">Looking back · {ago} card{ago === 1 ? '' : 's'} ago</p>
  {/if}
  {#if notice}<p class="notice">{notice}</p>{/if}

  <StudyCard item={shown} revealed={sitting.shownRevealed} typed={sitting.shownTyped}
             verdict={sitting.shownVerdict} picked={sitting.shownPicked}
             {audio} {keys} bind:showDefs bind:showForms bind:input
             onTyped={(value) => sitting.type(value)} onCheck={check} onPick={pick}
             onVoiceDone={() => (mediaSeq += 1)}>
    {#snippet aids()}
      <!-- The only things on the card that belong to the sitting rather than
           to the word: what to do now, and a flag on how it went. A card being
           looked back at has neither, since both are about an answer that has
           already been given. -->
      {#if !browsing && sitting.revealed}
      <div class="aids">
        {#if SAY_ALOUD.has(rung) && (has.fr || spoken)}
          <div class="say-first">
            <Mic size={14} /> Say it aloud too, and
            <button class="chip primary" onclick={() => void playModel()} disabled={making}>
              <Volume2 size={14} />
              {making ? 'making it…' : `hear ${PHRASED.has(rung) ? 'the sentence' : 'it'} again`}
              <Kbd id="playModel" {keys} />
            </button>
            to compare
          </div>
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
      {RUNG_LABEL[rung] ?? rung} · you answered <b>{sitting.past ? RATING_NAME[sitting.past.rating] : ''}</b>
    </p>
    <div class="grades nav">
      <button onclick={() => lookBack(-1)} disabled={!sitting.canOlder}>
        <ChevronLeft size={16} /> Older <Kbd id="older" {keys} />
      </button>
      <button onclick={() => lookBack(1)}>
        Newer <Kbd id="newer" {keys} />
      </button>
      <button class="primary" onclick={() => lookBack(sitting.history.length)}>Continue <Kbd id="continue" {keys} /></button>
    </div>
  {:else if !sitting.revealed && CHOSEN.has(rung)}
    <!-- a tap card is answered on the card; nothing to show until it is -->
  {:else if !sitting.revealed && !sitting.typing}
    <button class="primary wide" onclick={reveal}>Show <Kbd id="show" {keys} /></button>
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

<style>
  .lookback { display: flex; justify-content: flex-end; gap: 14px; margin-bottom: 4px; }
  .lookback button.link { display: inline-flex; align-items: center; gap: 3px; }
  .lookback button.link:disabled { opacity: .4; cursor: default; }
  .dir { color: var(--muted); font-size: 12px; text-transform: uppercase;
         letter-spacing: .07em; margin: 0 0 8px; }
  .aids { display: flex; flex-direction: column; align-items: center; gap: 10px;
          width: 100%; }
  .say-first { display: flex; align-items: center; justify-content: center; gap: 6px;
               flex-wrap: wrap; font-size: 14px; color: var(--ink); margin-top: 4px; }
  .say-first .chip.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
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
  .grades.nav { grid-template-columns: 1fr 1fr 1.4fr; }
  .grades.nav button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
  .grades.nav button:disabled { opacity: .4; cursor: default; }
  .grades .easy { color: var(--good); }
  .done { text-align: center; gap: 10px; }
  .done h1 { font-size: 22px; margin: 0 0 6px; }
  .big { font-size: 26px; font-weight: 650; margin: 0; }
  .good { color: var(--good); font-weight: 600; display: flex; align-items: center;
          justify-content: center; gap: 6px; margin: 4px 0; }
  .tiny { text-align: center; }
</style>
