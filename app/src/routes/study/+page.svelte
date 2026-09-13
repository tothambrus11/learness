<script lang="ts">
  /** One sitting. Each card shows the exercise for the rung its word has
   *  reached: recognise it, say it and check, write it, hear it for meaning,
   *  write down what was said. The card behaves the same way throughout —
   *  prompt, reveal, grade, look back — only what it asks changes.
   *
   *  What is *on* the card is StudyCard's business and nothing here decides
   *  it: this screen owns the queue, the clock, the sound and the grading, and
   *  hands the card the word. That division is the fix for a card looked back
   *  at showing less than it did when it was live.
   *
   *  With ?walk=1 the keyboard is taken away: only the rungs you can answer by
   *  speaking and tapping, the English cue read aloud, larger targets. It is
   *  the same queue, not a different deck.
   */
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { checkCloze, checkEnglish, checkFrench, ratingFor } from '$lib/check.js';
  import type { Check } from '$lib/check.js';
  import { answer, buildSession, forgetSitting, rememberSitting } from '$lib/session.js';
  import { restoreHistory } from '$lib/queue.js';
  import { setChrome } from '$lib/chrome.svelte.js';
  import { cueOf, sentenceAt, sentenceFor } from '$lib/cardface.js';
  import { HEARD_FIRST, RUNG_LABEL, SAY_ALOUD, TYPED } from '$lib/keys.js';
  import { GRADE_OF, pressOf, resolve as shortcutFor } from '$lib/shortcuts.js';
  import type { KeyContext, ShortcutId } from '$lib/shortcuts.js';
  import type { Rung } from '$lib/keys.js';
  import type { Settings } from '$lib/model.js';
  import type { HistoryEntry, StudyItem, Tally } from '$lib/queue.js';
  import type { Grade } from '$lib/scheduler.js';
  import { nowMs } from '$lib/units.js';
  import { canSayIn, hush, keepAwake, say } from '$lib/speech.js';
  import Kbd from '$lib/components/Kbd.svelte';
  import StudyCard from '$lib/components/StudyCard.svelte';
  import { prefetchMedia } from '$lib/prefetch.js';
  import { voices, warmSitting } from '$lib/voicequeue.js';
  import { sentenceSrc, srcFor } from '$lib/audio.js';
  import type { CardAudio, Sound } from '$lib/audio.js';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import Ear from '@lucide/svelte/icons/ear';
  import Mic from '@lucide/svelte/icons/mic';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import Volume2 from '@lucide/svelte/icons/volume-2';

  const walk = page.url.searchParams.get('walk') === '1';

  let loading = $state(true);
  let showForms = $state(false);     /* stays as you left it for the whole sitting */
  let showDefs = $state(true);       /* the definitions on the back; likewise remembered */
  let error = $state('');
  let items = $state<StudyItem[]>([]);
  let settings = $state<Settings | null>(null);
  let i = $state(0);
  let revealed = $state(false);
  let typed = $state('');
  let verdict = $state<Check | null>(null);
  /* Said aloud before the flip and it came out wrong. A flag beside the grade,
     never part of it: the grade is about the memory the card tests, and this
     is about a different one. */
  let saidWrong = $state(false);
  let notice = $state('');
  let resumed = $state(false);       /* this queue was left half-done and picked up again */
  let done = $state<Tally>({ answered: 0, right: 0, learned: 0, promoted: 0, heard: 0 });
  let startedAt = nowMs();
  let input = $state<HTMLInputElement | null>(null);
  let releaseWake: () => void = () => {};

  /* Every card answered this sitting, oldest first, so you can look back at
     one you graded too quickly. Looking back changes nothing: the grade
     stands, and the live card waits where it was. */
  let history = $state<HistoryEntry[]>([]);
  let back = $state<number | null>(null);   /* index into history, or null when live */
  let browsing = $derived(back !== null);

  let current = $derived(items[i] ?? null);
  let left = $derived(items.length - i);
  let finished = $derived(!loading && !error && (!items.length || i >= items.length));

  /* What is on screen: the live card, or the one being looked back at. */
  let past = $derived(back === null ? null : history[back] ?? null);
  let shown = $derived(past ? past.item : current);
  let shownRevealed = $derived(browsing || revealed);
  let shownTyped = $derived(past ? past.typed : typed);
  let shownVerdict = $derived(past ? past.verdict : verdict);

  let stopPrefetch: () => void = () => {};
  onDestroy(() => { stopPrefetch(); stopAudio(); releaseWake(); voices.clear(); });

  onMount(async () => {
    try {
      const built = await buildSession({ handsFree: walk });
      items = built.items;
      settings = built.settings;
      /* Carried on from before a reload: the same queue, the same place in it,
         and the answers already given. The words themselves were looked up
         again on the way in, so a correction made since is on the card. */
      if (built.resumed) {
        i = built.resumed.i;
        done = { answered: 0, right: 0, learned: 0, promoted: 0, heard: 0, ...built.resumed.done };
        history = restoreHistory(built.resumed.history, items);
        resumed = true;
      }
      stopPrefetch = prefetchMedia(items.slice(i).flatMap((it) =>
        [it.word.audio || it.word.native, walk ? it.word.cue_audio : null])).stop;
      /* The verbs in this sitting, said before they are asked for: a form that
         has to be made first takes a second and a half, and a second and a
         half after pointing at something is not an answer to pointing at it. */
      void warmSitting(items.slice(i).map((it) => it.word));
      if (walk) keepAwake().then((release) => { releaseWake = release; });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
      startedAt = nowMs();
      queueMicrotask(resume);
    }
  });

  /* What the title bar says while a sitting is on: where you are in it, and
     how far there is to go. */
  $effect(() => {
    if (loading || error) return;
    setChrome({
      title: walk ? 'Walk' : 'Study',
      subtitle: finished ? '' : `${left} left${resumed ? ' · carried on' : ''}`,
      progress: items.length ? Math.min(i, items.length) / items.length : null,
    });
  });

  const typing = (rung: Rung): boolean => TYPED.has(rung);

  /* What this card can play: files for catalogue words, clips made on this
     device for your own. Resolved once per card. */
  let has = $state({ fr: false, native: false, en: false });
  let mediaSeq = $state(0);          /* bumped when a clip is made, to look again */
  $effect(() => {
    const w = shown?.word;
    void mediaSeq;             /* read, so making a clip means looking again */
    has = { fr: false, native: false, en: false };
    trouble = '';
    if (!w) return;
    Promise.all([srcFor(w, 'fr'), srcFor(w, 'en')]).then(([fr, en]) => {
      if (shown?.word === w) has = { fr: !!fr, native: !!w.native, en: !!en };
    });
  });

  /* The word on screen is the one about to be pointed at, so whatever is
     waiting to be said for it goes to the front of the voice's queue. */
  $effect(() => {
    const key = shown?.word.k;
    if (key) voices.prefer(key);
  });

  /* Whether this device has a voice of its own in each language. Asked once:
     the French decides whether a sentence can be spoken at all, and the
     English is what reads a cue the catalogue has no recording of — which is
     most of them, and is why the back of a listening card had nothing to press
     until this was asked for. */
  let speaksFrench = $state(false);
  let speaksEnglish = $state(false);
  onMount(() => {
    canSayIn('fr').then((yes) => { speaksFrench = yes; });
    canSayIn('en').then((yes) => { speaksEnglish = yes; });
  });

  /** What to compare your answer against, out loud.
   *
   *  On a "use it" card that is the whole sentence, not the word alone: the
   *  word on its own is not what you just said, and the liaison and the rhythm
   *  around it are half of what the card teaches. The catalogue has no
   *  recording of a sentence — there are tens of thousands of them — so the
   *  browser's own French voice says it, and a device without one falls back to
   *  the recording of the word.
   */
  let speaking = $state(false);      /* the sentence is being made; it takes a moment */
  /** Why the last thing asked for could not be heard. Cleared by the next card
   *  and by the next sound that does play. */
  let trouble = $state('');

  /* Audio belongs to the card that asked for it.
     A model can take seconds to arrive — the sentence voice synthesises it on
     the device — and by then the card may have been graded and the next one
     dealt. Playing it there would say the next card's French aloud before it
     has been asked, which on a "write it" card is the answer. So every play
     carries the stamp the card had when it started, a stamp that changes with
     the card, and a play whose stamp has gone stale is dropped rather than
     heard. The same stamp stops the audio that is already sounding. */
  let playStamp = 0;
  let sounding: HTMLAudioElement | null = null;

  function stopAudio(): void {
    playStamp += 1;
    hush();                          /* the browser's own voice */
    sounding?.pause();
    sounding = null;
    speaking = false;
  }

  async function playModel(): Promise<boolean> {
    const stamp = playStamp;
    const item = shown;
    const sentence = item?.card?.rung === 'use' ? sentenceFor(item) : null;
    if (!sentence?.fr || !item) return play();
    speaking = true;
    try {
      /* The voice the cards are recorded in, where this device has it. It is
         made once and kept, so only the first hearing waits. */
      const src = await sentenceSrc(item.word, sentenceAt(item), sentence.fr).catch(() => null);
      if (stamp !== playStamp) return false;
      if (src && await playSrc(src, stamp)) return true;
      if (await say(sentence.fr, { lang: 'fr-FR', rate: 0.9 })) return true;
      return await play();
    } finally {
      if (stamp === playStamp) speaking = false;
    }
  }

  const playSrc = (src: string, stamp: number = playStamp): Promise<boolean> =>
    new Promise((resolve) => {
      if (stamp !== playStamp) return resolve(false);
      const a = new Audio(src);
      sounding = a;
      const settle = (ok: boolean): void => {
        if (sounding === a) sounding = null;
        resolve(ok);
      };
      a.onended = (): void => settle(true);
      a.onerror = (): void => settle(false);
      a.play().catch(() => settle(false));
    });

  /** This card has a sentence, and something to say it with. */
  let spoken = $derived(
    !!(speaksFrench && shown?.card?.rung === 'use' && sentenceFor(shown)?.fr));

  /** The English can be heard: a recording of the cue, or a voice here that
   *  will read it. On a walk it is read out whatever the device says, since a
   *  walk with nothing to listen to is not a walk. */
  let canCue = $derived(has.en || speaksEnglish || walk);

  /** A word's own recording: 'fr' the prompt, 'native' a human reading it,
   *  'en' the English cue.
   *
   *  A recording the server no longer has is the case this reports. It used to
   *  fail into the console — the missing file comes back as the app's own HTML,
   *  which decodes as nothing — and the button simply did nothing. Now the
   *  device says the word itself where it can, and says so where it cannot. */
  async function play(kind: Sound = 'fr'): Promise<boolean> {
    const stamp = playStamp;
    const w = shown?.word;
    const src = await srcFor(w, kind);
    if (src && await playSrc(src, stamp)) return heard();
    if (stamp !== playStamp) return false;
    if (kind === 'en') return (await say(w ? cueOf(w) : '')) ? heard() : missing('en');
    const spokenHere = await say(w?.answer || w?.fr, { lang: 'fr-FR' });
    return spokenHere ? heard() : missing(kind);
  }

  const heard = (): boolean => { trouble = ''; return true; };

  /** Nothing came out, and the card says so rather than the console. */
  function missing(kind: Sound): boolean {
    trouble = kind === 'en'
      ? 'No recording of the English for this word, and no English voice on this device.'
      : 'This word’s recording is missing, and this device has no French voice to stand in.';
    return false;
  }

  /* The English cue, spoken: the clip, or the browser's voice for a word
     without one. */
  async function cue(): Promise<void> {
    if (shown?.word) await play('en');
  }

  function reveal(): void {
    revealed = true;
    playAfterFlip();
  }

  function check(): void {
    if (!current) return;
    const { word, card } = current;
    const sentence = card.rung === 'use' ? sentenceFor(current) : null;
    verdict = sentence ? checkCloze(typed, sentence.f)
      : card.rung === 'hear' ? checkEnglish(typed, word)
        : checkFrench(typed, word);
    revealed = true;
    playAfterFlip();
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
    const rung = current?.card?.rung;
    if (!rung || HEARD_FIRST.has(rung)) return;
    void playModel().catch(() => {});   /* a card with no sound still flips */
  }

  /** The card's own question, said again: the French on a card asked by ear,
   *  the English cue on one asked from the English. Never the answer — this is
   *  reachable from inside the answer box, where the card has not been flipped
   *  yet. */
  function replayPrompt(): void {
    const rung = shown?.card?.rung;
    if (!rung) return;
    if (HEARD_FIRST.has(rung)) void play();
    else if (shownRevealed) void playModel();
    else void cue();
  }

  /* A second tap while the first answer is still being written would grade
     the same card twice and skip the next one. */
  let grading = $state(false);
  async function record(rating: Grade): Promise<void> {
    if (grading || !current || !settings) return;
    grading = true;
    /* Whatever is still being made or played was about this card. */
    stopAudio();
    const live = current;
    const { card, word } = live;
    let res;
    try {
      res = await answer(card, word, rating, settings, nowMs() - startedAt,
        { mispronounced: saidWrong });
    } finally {
      grading = false;
    }
    done.answered += 1;
    if (rating >= 3) done.right += 1;
    if (res.justLearned) done.learned += 1;
    if (res.promoted) { done.promoted += 1; flash(`Moved up: ${RUNG_LABEL[res.promoted]}`); }
    if (res.heardOpened) { done.heard += 1; flash('You said it, so now you will hear it too'); }
    /* Anything you could not recall comes back before the session ends. */
    if (rating === 1) items = [...items, { ...live, card: res.card }];
    history = [...history, { item: live, rating, typed, verdict }];
    i += 1;
    revealed = false;
    typed = '';
    verdict = null;
    saidWrong = false;
    startedAt = nowMs();
    /* Written down after every answer, so a reload — or a phone reclaiming the
       tab — comes back to this card rather than dealing a new one. */
    if (i >= items.length) await forgetSitting();
    else await rememberSitting({ items, i, walk, done, history });
    queueMicrotask(resume);
  }

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(text: string): void {
    notice = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { notice = ''; }, 2600);
  }

  /* Cue the live card: focus the box, play the audio prompt, or on a walk,
     read out the English. */
  function resume(): void {
    if (!current) return;
    const rung = current.card.rung;
    if (typing(rung)) input?.focus();
    if (HEARD_FIRST.has(rung)) void play();
    else if (walk && rung === 'say') void cue();
  }

  /** Step back one card, further back, or return to the live card. */
  function lookBack(step: number): void {
    const at = browsing ? back ?? 0 : history.length;
    const next = at + step;
    if (next < 0) return;
    /* What was playing was about the card being left. */
    stopAudio();
    if (next >= history.length) {
      /* Time spent looking back is not time spent on the live card. */
      back = null;
      startedAt = nowMs();
      queueMicrotask(resume);
    } else {
      back = next;
    }
  }

  /** The sitting as the keyboard sees it: which card is on screen, which way
   *  up, and what it can play. Every hint on the screen is drawn from this,
   *  and every keypress is read against it, so the two cannot disagree. */
  let keys = $derived<KeyContext>({
    idle: loading || finished || !shown,
    browsing,
    revealed: shownRevealed,
    rung: shown?.card.rung ?? null,
    canOlder: history.length > 0 && back !== 0,
    has,
    spoken,
    canCue,
  });

  /** What each shortcut does. The table says when a key means one of these;
   *  this says what it is. Grades are the four ratings. */
  const ACTION: Record<ShortcutId, () => void> = {
    older: () => lookBack(-1),
    newer: () => lookBack(1),
    continue: () => lookBack(history.length),
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
    flagSaid: () => { saidWrong = !saidWrong; },
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
    speaking,
    trouble,
    play: (kind: Sound = 'fr'): void => { void play(kind); },
    playModel: (): void => { void playModel(); },
    cue: (): void => { void cue(); },
  });
</script>

<svelte:window onkeydown={onKeyDown} />

{#if !finished && !loading && current && history.length}
  <div class="lookback">
    <button class="link" onclick={() => lookBack(-1)} disabled={back === 0}
            aria-label="Previous card"><ChevronLeft size={14} /> Previous card <Kbd id="older" {keys} /></button>
  </div>
{/if}

{#if loading}
  <p class="muted">Preparing a {walk ? 'walk' : 'session'}…</p>
{:else if error}
  <p class="error">{error}</p>
{:else if finished}
  <section class="panel done">
    <h1>{done.answered ? (walk ? 'Walk done' : 'Session done') : 'Nothing due'}</h1>
    {#if done.answered}
      <p class="big">{done.right} / {done.answered} right</p>
      {#if done.promoted}<p class="good"><ArrowUp size={15} /> {done.promoted} word{done.promoted === 1 ? '' : 's'} moved up a rung</p>{/if}
      {#if done.heard}<p class="good"><Ear size={15} /> {done.heard} now practised by ear too</p>{/if}
      {#if done.learned}<p class="good">{done.learned} words now known</p>{/if}
    {:else if walk}
      <p class="muted">
        Nothing on the walk right now: no card you could answer by speaking is
        due. Words reach the walk once you have met them.
      </p>
    {:else}
      <p class="muted">
        Nothing is due and no new words are allowed today. The daily allowance
        is worked out from how much is already due and how well recall has been
        going.
      </p>
    {/if}
    <button class="primary" onclick={() => goto(`${base}/`)}>Home</button>
  </section>
{:else if shown}
  {@const rung = shown.card.rung}
  {#if browsing}
    {@const ago = history.length - (back ?? 0)}
    <p class="dir">Looking back · {ago} card{ago === 1 ? '' : 's'} ago</p>
  {/if}
  {#if notice}<p class="notice">{notice}</p>{/if}

  <StudyCard item={shown} revealed={shownRevealed} typed={shownTyped} verdict={shownVerdict}
             {walk} {audio} {keys} bind:showDefs bind:showForms bind:input
             onTyped={(value) => (typed = value)} onCheck={check}
             onVoiceDone={() => (mediaSeq += 1)}>
    {#snippet aids()}
      <!-- The only things on the card that belong to the sitting rather than
           to the word: what to do now, and a flag on how it went. A card being
           looked back at has neither, since both are about an answer that has
           already been given. -->
      {#if !browsing && shownRevealed}
      <div class="aids">
        {#if SAY_ALOUD.has(rung) && (has.fr || spoken)}
          <div class="say-first">
            <Mic size={14} /> Say it aloud too, and
            <button class="chip primary" onclick={() => void playModel()} disabled={speaking}>
              <Volume2 size={14} />
              {speaking ? 'making it…' : `hear ${rung === 'use' ? 'the sentence' : 'it'} again`}
              <Kbd id="playModel" {keys} />
            </button>
            to compare
          </div>
        {/if}
        {#if has.fr}
          <button class="chip flag" class:on={saidWrong} aria-pressed={saidWrong}
                  onclick={() => (saidWrong = !saidWrong)}>
            <MicOff size={15} /> I said it wrong <Kbd id="flagSaid" {keys} />
          </button>
        {/if}
      </div>
      {/if}
    {/snippet}
  </StudyCard>

  {#if browsing}
    <p class="muted tiny">
      {RUNG_LABEL[rung] ?? rung} · you answered <b>{past ? RATING_NAME[past.rating] : ''}</b>
    </p>
    <div class="grades nav">
      <button onclick={() => lookBack(-1)} disabled={back === 0}>
        <ChevronLeft size={16} /> Older <Kbd id="older" {keys} />
      </button>
      <button onclick={() => lookBack(1)}>
        Newer <Kbd id="newer" {keys} />
      </button>
      <button class="primary" onclick={() => lookBack(history.length)}>Continue <Kbd id="continue" {keys} /></button>
    </div>
  {:else if !revealed && !typing(rung)}
    <button class="primary wide" class:big={walk} onclick={reveal}>Show <Kbd id="show" {keys} /></button>
  {:else if revealed}
    <div class="grades" class:walk>
      <button onclick={() => record(1)} class="again" disabled={grading}>Again <Kbd id="again" {keys} /></button>
      <button onclick={() => record(2)} disabled={grading}>Hard <Kbd id="hard" {keys} /></button>
      <button onclick={() => record(3)} disabled={grading}>Good <Kbd id="good" {keys} /></button>
      <button onclick={() => record(4)} class="easy" disabled={grading}>Easy <Kbd id="easy" {keys} /></button>
    </div>
    {#if shownVerdict}
      <p class="muted tiny">
        Suggested: {['', 'Again', 'Hard', 'Good', 'Good'][ratingFor(shownVerdict.verdict)]}
      </p>
    {/if}
  {/if}
{/if}

<style>
  .lookback { display: flex; justify-content: flex-end; margin-bottom: 4px; }
  .lookback button.link { display: inline-flex; align-items: center; gap: 3px; }
  .lookback button.link:disabled { opacity: .4; cursor: default; }
  .dir { color: var(--muted); font-size: 12px; text-transform: uppercase;
         letter-spacing: .07em; margin: 0 0 8px; }
  .aids { display: flex; flex-direction: column; align-items: center; gap: 10px;
          width: 100%; }
  .say-first { display: flex; align-items: center; justify-content: center; gap: 6px;
               flex-wrap: wrap; font-size: 14px; color: var(--ink); margin-top: 4px; }
  .say-first .chip.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .notice { font-size: 13px; color: var(--good); background: var(--panel);
            border: 1px solid var(--good); border-radius: 10px; padding: 8px 12px;
            margin: 0 0 10px; }
  .panel { background: var(--panel); border: 1px solid var(--line);
           border-radius: 14px; padding: 22px 18px; }
  .chip { font-size: 13px; padding: 6px 12px; border-radius: 999px; font-weight: 500; }
  .chip.on { background: var(--warn); color: var(--on-warn); border-color: var(--warn); }
  .chip:disabled { opacity: .65; cursor: progress; }
  button { font: inherit; font-weight: 600; padding: 11px 16px; border-radius: 10px;
           border: 1px solid var(--line); background: var(--panel); color: var(--ink);
           cursor: pointer; }
  button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  button.wide { width: 100%; margin-top: 12px; }
  button.big { font-size: 20px; padding: 18px; }
  button.link { border: none; background: none; color: var(--muted); padding: 4px 0;
                font-weight: 400; font-size: 13px; }
  .grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
            margin-top: 12px; }
  .grades button { padding: 12px 4px; font-size: 13.5px; }
  .grades.walk button { padding: 18px 4px; font-size: 16px; }
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
  .muted { color: var(--muted); }
  .tiny { font-size: 12px; text-align: center; }
  .error { color: var(--bad); }
</style>
