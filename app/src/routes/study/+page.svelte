<script lang="ts">
  /** One sitting. Each card shows the exercise for the rung its word has
   *  reached: recognise it, say it and check, write it, hear it for meaning,
   *  write down what was said. */

  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { sentenceSrc, srcFor } from '$lib/audio';
  import { checkCloze, checkEnglish, checkFrench, ratingFor } from '$lib/check';
  import { setChrome } from '$lib/chrome.svelte';
  import Conjugation from '$lib/components/Conjugation.svelte';
  import Fr from '$lib/components/Fr.svelte';
  import VoiceWork from '$lib/components/VoiceWork.svelte';
  import { RUNG_LABEL, TYPED } from '$lib/keys';
  import { prefetchMedia } from '$lib/prefetch';
  import { restoreHistory } from '$lib/queue';
  import { answer, buildSession, forgetSitting, rememberSitting } from '$lib/session';
  import { canSayIn, hush, say } from '$lib/speech';
  import type {
    CheckResult,
    Example,
    Rung,
    Settings,
    SittingHistoryEntry,
    SittingItem,
    SittingSnapshot,
    SittingTally,
    StudyWord,
    Verdict,
  } from '$lib/types';
  import { listFields } from '$lib/wordform';
  import type { LucideProps } from '@lucide/svelte';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import AudioLines from '@lucide/svelte/icons/audio-lines';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ear from '@lucide/svelte/icons/ear';
  import Eye from '@lucide/svelte/icons/eye';
  import Keyboard from '@lucide/svelte/icons/keyboard';
  import Mic from '@lucide/svelte/icons/mic';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Volume1 from '@lucide/svelte/icons/volume-1';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import type { Component } from 'svelte';
  import { onDestroy, onMount } from 'svelte';
  import type { Grade } from 'ts-fsrs';

  /** True until the queue has been built, however it was built. */
  let loading = $state(true);
  /** True while the verb tables are shown. Stays as you left it for the whole
   *  sitting. */
  let showForms = $state(false);
  /** True while the definitions on the back are shown. Likewise remembered for
   *  the whole sitting. */
  let showDefs = $state(true);
  /** Why the sitting could not be built; `''` when it was. */
  let error = $state('');
  /** The queue, in the order it is dealt. An "Again" pushes a copy onto the
   *  end, so this grows during the sitting. */
  let items = $state<SittingItem[]>([]);
  /** The settings the sitting was built with, null until it has been. */
  let settings = $state<Settings | null>(null);
  /** How far through the queue: the index of the live card. */
  let i = $state(0);
  /** Whether the live card has been flipped. */
  let revealed = $state(false);
  /** What is in the answer box on the live card. */
  let typed = $state('');
  /** How the live card's typing was graded, or null where nothing has been
   *  typed or the rung does not take typing. */
  let verdict = $state<CheckResult | null>(null);
  /** True once the live card was said aloud before the flip and it came out
   *  wrong. Cleared on every answer. */
  let saidWrong = $state(false);
  /** A congratulation that fades: a rung climbed, an ear opened. `''` when
   *  there is nothing to say. */
  let notice = $state('');
  /** Why the last answer could not be written down; `''` when it was. */
  let saveError = $state('');
  /** True when this queue was left half-done and picked up again. */
  let resumed = $state(false);
  /** A tally with nothing in it: what a sitting starts at, and the floor a
   *  resumed sitting's own tally is laid over. */
  const NO_TALLY: SittingTally = { answered: 0, right: 0, learned: 0, promoted: 0, heard: 0 };
  /** What this sitting has achieved so far, and what the "session done" panel
   *  reports. Carried forward when a sitting is resumed. */
  let done = $state<SittingTally>({ ...NO_TALLY });
  /** Milliseconds when the live card went up, so the answer can be timed.
   *  Reset on every answer, and again on coming back from looking back: time
   *  spent reading an old card is not time spent on this one. */
  let startedAt = 0;
  /** The answer box, where the rung has one, so it can be focused. */
  let input = $state<HTMLInputElement | null>(null);

  /** Every card answered this sitting, oldest first. */
  let history = $state<SittingHistoryEntry[]>([]);
  /** Which entry of `history` is being looked at, or null while the live card is
   *  on screen. */
  let back = $state<number | null>(null);
  /** True while an answered card is being looked at rather than the live one.
   *  Exactly `back !== null`; the markup tests `back` and `past` directly where
   *  it needs what they hold. */
  let browsing = $derived(back !== null);

  /** The live card, or null once the queue is exhausted. */
  let current = $derived(items[i] ?? null);
  /** Cards still to answer, the live one included. */
  let left = $derived(items.length - i);
  /** True when the queue is done — or was empty to begin with — and neither
   *  loading nor an error is on screen instead. */
  let finished = $derived(!loading && !error && (!items.length || i >= items.length));

  /** The answered card being looked back at, or null while the live one is on
   *  screen. */
  let past = $derived(back === null ? null : history[back]);
  /** The card on screen, whether live or looked back at; null when there is
   *  none to show. */
  let shown = $derived(past ? past.item : current);
  /** Whether what is on screen is flipped. A card looked back at always is:
   *  its answer was given. */
  let shownRevealed = $derived(browsing || revealed);
  /** What was typed on the card on screen. */
  let shownTyped = $derived(past ? past.typed : typed);
  /** How that typing was graded, or null where there was none. */
  let shownVerdict = $derived(past ? past.verdict : verdict);

  /** Stops the media prefetch started for this queue. A no-op until one has
   *  been started, and after the sitting is left. */
  let stopPrefetch = () => {};
  /** Whether the screen has been left. The prefetch starts only once the queue
   *  is built, which is after the learner may already have gone back, so the
   *  teardown records that it has run and the prefetch is then not started at
   *  all rather than downloading a whole queue nobody is looking at. */
  let gone = false;
  onDestroy(() => {
    gone = true;
    stopPrefetch();
    hush();
  });

  /** Take a sitting up where it was left: the same place in the same queue, and
   *  the answers already given. `items` must already hold its queue. */
  function carryOn(saved: SittingSnapshot): void {
    i = saved.i;
    done = { ...NO_TALLY, ...saved.done };
    history = restoreHistory(saved.history, items);
    resumed = true;
  }

  onMount(async () => {
    try {
      const built = await buildSession();
      items = built.items;
      settings = built.settings;
      if (built.resumed) carryOn(built.resumed);
      if (!gone) {
        stopPrefetch = prefetchMedia(
          items.slice(i).map((it) => it.word.audio || it.word.native),
        ).stop;
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
      startedAt = Date.now();
      queueMicrotask(resume);
    }
  });

  $effect(() => {
    if (loading || error) return;
    setChrome({
      title: 'Study',
      subtitle: finished ? '' : `${left} left${resumed ? ' · carried on' : ''}`,
      progress: items.length ? Math.min(i, items.length) / items.length : null,
    });
  });

  /** Whether a rung's answer is typed rather than recalled and graded by hand. */
  const typing = (rung: Rung): boolean => TYPED.has(rung);
  /** The English a card prompts with: the catalogue's shortened cue, or the
   *  first translation cut at its first semicolon where there is none. */
  const cueOf = (w: StudyWord): string => w.cue ?? w.en[0].split(';')[0].trim();

  /** Which of a word's sentences a "use it" card blanks, as an index into
   *  `word.ex`; -1 where there is none to blank. Chosen from the card's own
   *  repetition count, so looking back shows the sentence you were asked. */
  const sentenceAt = (item: SittingItem | null): number => {
    const ex = item?.word?.ex;
    if (!item || !ex?.length) return -1;
    return item.card.reps % ex.length;
  };
  /** The sentence itself, or null where the word has none to blank. */
  const sentenceFor = (item: SittingItem | null): Example | null => {
    const at = sentenceAt(item);
    return at < 0 ? null : (item?.word.ex?.[at] ?? null);
  };
  /** The sentence the card on screen blanks, or null where it has none.
   *  Bound here rather than called in the markup so the "use it" branch and
   *  the sentence it shows are provably the same one. */
  let shownSentence = $derived(sentenceFor(shown));
  /** The sentence with its word taken out, as text before and after the gap.
   *  A word the regular expression cannot find in its own sentence leaves the
   *  whole sentence before the gap, which reads as the sentence unchanged. */
  function blank(sentence: Example): { before: string; after: string } {
    const re = new RegExp(
      `(^|[^\\p{L}])(${sentence.f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}])`,
      'iu',
    );
    const m = re.exec(sentence.fr);
    if (!m) return { before: sentence.fr, after: '' };
    const at = m.index + m[1].length;
    return { before: sentence.fr.slice(0, at), after: sentence.fr.slice(at + m[2].length) };
  }

  /** What the card on screen can play: the French, the native recording, the
   *  English. All false while a card is being resolved. */
  let has = $state({ fr: false, native: false, en: false });
  /** Bumped whenever a clip is made, so what can be played is looked up again. */
  let mediaSeq = $state(0);
  $effect(() => {
    const w = shown?.word;
    void mediaSeq;
    has = { fr: false, native: false, en: false };
    if (!w) return;
    Promise.all([srcFor(w, 'fr'), srcFor(w, 'en')]).then(([fr, en]) => {
      if (shown?.word === w) has = { fr: !!fr, native: !!w.native, en: !!en };
    });
  });

  /** True where this device has a French voice of its own. False until the
   *  question has been answered. */
  let speaksFrench = $state(false);
  onMount(() => {
    canSayIn('fr').then((yes) => {
      speaksFrench = yes;
    });
  });

  /** True while a sentence is being made, which takes a moment. */
  let speaking = $state(false);
  /** Play what to compare your answer against: the whole sentence on a "use it"
   *  card, the word itself otherwise. A sentence is made here, since none is
   *  recorded; a device with no French voice falls back to the word. */
  async function playModel(): Promise<boolean> {
    const sentence = shown?.card?.rung === 'use' ? sentenceFor(shown) : null;
    if (!shown || !sentence?.fr) return play();
    speaking = true;
    try {
      const src = await sentenceSrc(shown.word, sentenceAt(shown), sentence.fr).catch(
        () => null,
      );
      if (src) return await playSrc(src);
      if (await say(sentence.fr, { lang: 'fr-FR', rate: 0.9 })) return true;
      return await play();
    } finally {
      speaking = false;
    }
  }

  /** Play one audio file to the end. Resolves true when it finished, false when
   *  the browser refused it or it could not be loaded. Never rejects. */
  const playSrc = (src: string): Promise<boolean> =>
    new Promise((resolve) => {
      const a = new Audio(src);
      a.onended = () => resolve(true);
      a.onerror = () => resolve(false);
      a.play().catch(() => resolve(false));
    });

  /** This card has a sentence, and something to say it with. */
  let spoken = $derived(
    !!(speaksFrench && shown?.card?.rung === 'use' && sentenceFor(shown)?.fr),
  );

  /** Play one of the card word's recordings. Resolves false where there is
   *  nothing to play.
   *
   *  @param kind which recording: the French, the native speaker, the English.
   */
  async function play(kind: 'fr' | 'native' | 'en' = 'fr'): Promise<boolean> {
    const src = await srcFor(shown?.word, kind);
    return src ? playSrc(src) : false;
  }

  /** Say the English cue aloud: the clip where there is one, the browser's own
   *  voice otherwise. */
  async function cue(): Promise<void> {
    const w = shown?.word;
    if (!w) return;
    if (!(await play('en'))) await say(cueOf(w));
  }

  /** Flip the live card. The French is played on the two rungs where it is the
   *  answer being checked rather than something to produce first. */
  function reveal(): void {
    revealed = true;
    const rung = current?.card.rung;
    if (rung === 'recognise' || rung === 'say') play();
  }

  /** Grade what was typed on the live card and flip it. The verdict is
   *  advisory: the grade buttons are still the learner's to press. */
  function check(): void {
    if (!current) return;
    const { word, card } = current;
    const sentence = card.rung === 'use' ? sentenceFor(current) : null;
    verdict = sentence
      ? checkCloze(typed, sentence.f)
      : card.rung === 'hear'
        ? checkEnglish(typed, word)
        : checkFrench(typed, word);
    revealed = true;
    if (!SAY_FIRST.has(card.rung)) play();
  }

  /** Rungs where the answer is typed from the English, so the spoken form is
   *  yours to check against the model afterwards. */
  const SAY_FIRST: ReadonlySet<Rung> = new Set<Rung>(['write', 'use']);

  /** The rating for an answer that would not come, which puts the card back on
   *  the end of the queue as well as rescheduling it. */
  const AGAIN = 1;
  /** True while an answer is being written down, which disables the grades: a
   *  second tap would grade the same card twice and skip the next one. */
  let grading = $state(false);
  /** Write down one answer and move on: grade the card, tally what happened,
   *  keep an "Again" in the queue, remember the sitting, and cue the next card.
   *  An answer that could not be written leaves everything where it was. */
  async function record(rating: Grade): Promise<void> {
    if (grading || !current || !settings) return;
    grading = true;
    saveError = '';
    const { card, word } = current;
    let res: Awaited<ReturnType<typeof answer>>;
    try {
      res = await answer(card, word, rating, settings, Date.now() - startedAt, {
        mispronounced: saidWrong,
      });
    } catch (err) {
      saveError = `That answer was not saved (${(err as Error)?.message || err}). Try again.`;
      return;
    } finally {
      grading = false;
    }
    done.answered += 1;
    if (rating >= 3) done.right += 1;
    if (res.justLearned) done.learned += 1;
    if (res.promoted) {
      done.promoted += 1;
      flash(`Moved up: ${RUNG_LABEL[res.promoted]}`);
    }
    if (res.heardOpened) {
      done.heard += 1;
      flash('You said it, so now you will hear it too');
    }
    if (rating === AGAIN) items = [...items, { ...current, card: res.card }];
    history = [...history, { item: current, rating, typed, verdict }];
    i += 1;
    revealed = false;
    typed = '';
    verdict = null;
    saidWrong = false;
    startedAt = Date.now();
    if (i >= items.length) await forgetSitting();
    else await rememberSitting({ items, i, done, history });
    queueMicrotask(resume);
  }

  /** The timer that clears the current notice, so a second congratulation
   *  replaces the first rather than being wiped by its timeout. */
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  /** Say something for a couple of seconds and then stop saying it. */
  function flash(text: string): void {
    notice = text;
    clearTimeout(flashTimer ?? undefined);
    flashTimer = setTimeout(() => {
      notice = '';
    }, 2600);
  }

  /** Cue the live card: focus the answer box, or play the audio prompt. Does
   *  nothing once the queue is exhausted. */
  function resume(): void {
    if (!current) return;
    const rung = current.card.rung;
    if (typing(rung)) input?.focus();
    if (rung === 'hear' || rung === 'dictate') play();
  }

  /** Step back one card, further back, or return to the live card. */
  function lookBack(step: number): void {
    const at = back ?? history.length;
    const next = at + step;
    if (next < 0) return;
    if (next >= history.length) {
      back = null;
      startedAt = Date.now();
      queueMicrotask(resume);
    } else {
      back = next;
    }
  }

  /** Enter in the answer box checks the answer, and does nothing once the card
   *  is already flipped. */
  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    if (!revealed && current && typing(current.card.rung)) check();
  }

  /** The whole sitting from the keyboard: 1–4 grade; space flips the card, or
   *  comes back to the live one when looking back; ← and → walk the history;
   *  s, n and e play the French, the native recording and the English; d shows
   *  the definitions; p flags a mispronunciation. Keys typed into the answer
   *  box belong to the box. */
  function onGlobalKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const t = event.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    )
      return;
    if (loading || finished || !shown) return;
    const key = event.key;
    const rung = shown.card.rung;
    const heardFirst = rung === 'hear' || rung === 'dictate';
    /** The French may be played once the card is flipped, and on a card whose
     *  question is the sound, before the flip as well — never on one whose
     *  answer it is. */
    const mayHearFrench = revealed || heardFirst;
    let handled = true;
    if (key === 'ArrowLeft') lookBack(-1);
    else if (key === 'ArrowRight') {
      if (browsing) lookBack(1);
      else handled = false;
    } else if (key === ' ' || key === 'Enter') {
      if (browsing) lookBack(history.length);
      else if (!revealed && !typing(rung)) reveal();
      else handled = false;
    } else if (key === 's' && (has.fr || spoken) && mayHearFrench) playModel();
    else if (key === 'n' && has.native && mayHearFrench) play('native');
    else if (key === 'e' && has.en && !heardFirst) cue();
    else if (browsing) handled = false;
    else if (key.length === 1 && '1234'.includes(key) && revealed) record(Number(key) as Grade);
    else if (key === 'p' && revealed && has.fr) saidWrong = !saidWrong;
    else if (key === 'd' && revealed) showDefs = !showDefs;
    else handled = false;
    if (handled) event.preventDefault();
  }

  /** What each grade is called, indexed by the FSRS rating itself. Index 0 is
   *  empty because there is no rating 0: the scale starts at Again. */
  const RATING_NAME = ['', 'Again', 'Hard', 'Good', 'Easy'] as const;

  /** What the grade a verdict suggests is called, indexed the same way. A card
   *  the checker was happy with suggests Good and never Easy, which is the
   *  learner's to choose. */
  const SUGGESTED_NAME = ['', 'Again', 'Hard', 'Good', 'Good'] as const;

  /** How one rung's exercise is drawn in the task strip. */
  interface TaskSpec {
    /** Which language the question is in. */
    from: 'fr' | 'en';
    /** True where the question is a sound rather than something read. */
    heard: boolean;
    /** The icon for the action, drawn between the two language badges. */
    icon: Component<LucideProps>;
    /** The action itself, in the imperative, as the strip reads it out. */
    verb: string;
    /** Which language the answer is in. */
    to: 'fr' | 'en';
  }

  /** What each rung asks, at a glance. Every rung has an entry. */
  const TASK: Record<Rung, TaskSpec> = {
    recognise: {
      from: 'fr',
      heard: false,
      icon: Eye,
      verb: 'Read it, recall the English',
      to: 'en',
    },
    say: {
      from: 'en',
      heard: false,
      icon: Mic,
      verb: 'Say it in French, then check',
      to: 'fr',
    },
    write: {
      from: 'en',
      heard: false,
      icon: Keyboard,
      verb: 'Type the French, then say it',
      to: 'fr',
    },
    hear: { from: 'fr', heard: true, icon: Ear, verb: 'Listen, recall the English', to: 'en' },
    dictate: {
      from: 'fr',
      heard: true,
      icon: Keyboard,
      verb: 'Listen, type what you heard',
      to: 'fr',
    },
    use: {
      from: 'fr',
      heard: false,
      icon: PenLine,
      verb: 'Fill the gap in the sentence',
      to: 'fr',
    },
  };

  /** The English senses worth adding to what the card already shows: every
   *  sense the word has, longest form first, with the one already printed as
   *  the answer dropped. */
  function senses(word: StudyWord): string[] {
    /* `def.en` holds the first few translations unshortened; `word.en` holds
       all of them, shortened for the front of the card. */
    const primary = (word?.en?.[0] ?? '').toLowerCase().trim();
    const seen = new Set(primary ? [primary] : []);
    const out = [];
    for (const line of [...(word?.def?.en ?? []), ...(word?.en ?? [])]) {
      const text = String(line ?? '')
        .replace(/\s+([,;])/g, '$1')
        .trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  }

  /** What each verdict is called on the back of a card. */
  const verdictText: Record<Verdict, string> = {
    ok: 'Correct',
    accent: 'Right, mind the accents',
    article: 'Right, mind the article',
    close: 'Almost, a typo',
    no: 'Not quite',
  };
</script>

<svelte:window onkeydown={onGlobalKey} />

{#if !finished && !loading && current && history.length}
  <div class="lookback">
    <button
      class="link"
      onclick={() => lookBack(-1)}
      disabled={back === 0}
      aria-label="Previous card"><ChevronLeft size={14} /> Previous card <kbd>←</kbd></button
    >
  </div>
{/if}

{#if loading}
  <p class="muted">Preparing a session…</p>
{:else if error}
  <p class="error">{error}</p>
{:else if finished}
  <section class="panel done">
    <h1>{done.answered ? 'Session done' : 'Nothing due'}</h1>
    {#if done.answered}
      <p class="big">{done.right} / {done.answered} right</p>
      {#if done.promoted}<p class="good">
          <ArrowUp size={15} />
          {done.promoted} word{done.promoted === 1 ? '' : 's'} moved up a rung
        </p>{/if}
      {#if done.heard}<p class="good">
          <Ear size={15} />
          {done.heard} now practised by ear too
        </p>{/if}
      {#if done.learned}<p class="good">{done.learned} words now known</p>{/if}
    {:else}
      <p class="muted">
        Nothing is due and no new words are allowed today. The daily allowance is worked out
        from how much is already due and how well recall has been going.
      </p>
    {/if}
    <button class="primary" onclick={() => goto(`${base}/`)}>Home</button>
  </section>
{:else if shown}
  {@const w = shown.word}
  {@const rung = shown.card.rung}
  {@const revealed = shownRevealed}
  {@const verdict = shownVerdict}
  {@const task = TASK[rung] ?? TASK.write}
  {#if back !== null}
    <p class="dir">
      Looking back · {history.length - back} card{history.length - back === 1 ? '' : 's'} ago
    </p>
  {/if}
  <div
    class="task"
    aria-label="{task.verb}: {task.from === 'fr' ? 'French' : 'English'} to {task.to === 'fr'
      ? 'French'
      : 'English'}"
  >
    <span class="lang {task.from}">
      {#if task.heard}<Volume2 size={13} />{:else}<Eye size={13} />{/if}
      {task.from === 'fr' ? 'FR' : 'EN'}
    </span>
    <span class="arrow">→</span>
    <span class="verb"><task.icon size={15} /> {task.verb}</span>
    <span class="arrow">→</span>
    <span class="lang {task.to}">{task.to === 'fr' ? 'FR' : 'EN'}</span>
  </div>
  {#if notice}<p class="notice">{notice}</p>{/if}

  <section class="panel card">
    {#if rung === 'recognise'}
      <div class="prompt"><Fr text={w.fr} gender={w.gender} /></div>
      {#if revealed}
        <div class="ipa">{w.ipa}</div>
        <div class="answer">{w.en[0]}</div>
        {#if w.en.length > 1}<div class="alts">{w.en.slice(1, 4).join(' · ')}</div>{/if}
      {/if}
    {:else if rung === 'say'}
      <div class="prompt">{cueOf(w)}</div>
      <div class="hint">{w.pos}{revealed && w.gender ? `, ${w.gender}` : ''}</div>
      {#if !revealed}
        <div class="status muted">Say it in French, then</div>
      {:else}
        <div class="answer fr"><Fr text={w.answer} gender={w.gender} /></div>
        <div class="ipa">{w.ipa}</div>
      {/if}
    {:else if rung === 'hear'}
      <button class="speaker" onclick={() => play()}>
        <Volume2 size={44} />
        <span class="again">Play it again <kbd>s</kbd></span>
      </button>
      {#if revealed}
        <div class="prompt small"><Fr text={w.fr} gender={w.gender} /></div>
        <div class="ipa">{w.ipa}</div>
        <div class="answer">{w.en[0]}</div>
      {/if}
    {:else if rung === 'use' && shownSentence}
      {@const s = shownSentence}
      {@const gap = blank(s)}
      <div class="sentence">
        {gap.before}<span class="gap" class:filled={revealed}>{revealed ? s.f : '    '}</span
        >{gap.after}
      </div>
      <div class="hint">{s.en}</div>
      <div class="alts">{w.en[0]}{revealed && w.gender ? ` · ${w.gender}` : ''}</div>
      {#if !revealed}
        <input
          bind:this={input}
          bind:value={typed}
          onkeydown={onKey}
          type="text"
          placeholder="the missing word"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
        />
        <button class="primary" onclick={check}>Check</button>
      {:else}
        <div class="verdict" class:ok={verdict && verdict.verdict !== 'no'}>
          {verdict ? verdictText[verdict.verdict] : ''}
        </div>
        <div class="answer fr"><Fr text={w.answer} gender={w.gender} /></div>
        <div class="ipa">{w.ipa}</div>
        {#if shownTyped && verdict?.verdict !== 'ok'}
          <div class="alts">you wrote <b>{shownTyped}</b></div>
        {/if}
      {/if}
    {:else}
      <!-- write, dictate: the French is typed -->
      {#if rung === 'dictate'}
        <button class="speaker" onclick={() => play()}>
          <Volume2 size={44} />
          <span class="again">Play it again <kbd>s</kbd></span>
        </button>
      {:else}
        <div class="prompt">{w.en[0]}</div>
      {/if}
      <div class="hint">{w.pos}{revealed && w.gender ? `, ${w.gender}` : ''}</div>
      {#if !revealed}
        <input
          bind:this={input}
          bind:value={typed}
          onkeydown={onKey}
          type="text"
          placeholder="type the French"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
        />
        <button class="primary" onclick={check}>Check</button>
      {:else}
        <div class="verdict" class:ok={verdict && verdict.verdict !== 'no'}>
          {verdict ? verdictText[verdict.verdict] : ''}
        </div>
        <div class="answer fr"><Fr text={w.answer} gender={w.gender} /></div>
        <div class="ipa">{w.ipa}</div>
        {#if shownTyped && verdict?.verdict !== 'ok'}
          <div class="alts">you wrote <b>{shownTyped}</b></div>
        {/if}
      {/if}
    {/if}

    {#if w.missing?.length}
      <p class="incomplete">
        <TriangleAlert size={15} />
        This word has no {listFields(w.missing)} yet.
        <a href="{base}/words/">Fix it</a>
      </p>
    {/if}
    {#if w.user}
      <div class="card-voice"><VoiceWork words={[w]} onDone={() => (mediaSeq += 1)} /></div>
    {/if}
    {#if revealed && w.note}<div class="alts">{w.note}</div>{/if}
    {#if revealed && !browsing && SAY_FIRST.has(rung) && (has.fr || spoken)}
      <div class="say-first">
        <Mic size={14} /> Now say it aloud, then
        <button class="chip primary" onclick={playModel} disabled={speaking}>
          <Volume2 size={14} />
          {speaking ? 'making it…' : `hear ${rung === 'use' ? 'the sentence' : 'it'}`}
          <kbd>s</kbd>
        </button>
        and compare
      </div>
    {/if}
    {#if revealed && (w.def?.fr?.length || senses(w).length)}
      <div class="defs" class:closed={!showDefs}>
        <button
          class="defs-toggle"
          onclick={() => (showDefs = !showDefs)}
          aria-expanded={showDefs}
        >
          {#if showDefs}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
          Definition <kbd>d</kbd>
        </button>
        {#if showDefs}
          {#if w.def?.fr?.length}
            <ol class="def fr-def">
              {#each w.def.fr as line}<li><span class="lang fr">FR</span> {line}</li>{/each}
            </ol>
          {/if}
          {#if senses(w).length}
            <p class="def en-line"><span class="lang en">EN</span> {senses(w).join(' · ')}</p>
          {/if}
        {/if}
      </div>
    {/if}
    {#if revealed && (has.fr || has.en || spoken)}
      <div class="audio">
        {#if has.fr || spoken}
          <button class="chip" onclick={playModel} disabled={speaking}>
            <Volume2 size={15} />
            {speaking ? 'Making it…' : rung === 'use' ? 'Hear the sentence' : 'Hear again'}
            <kbd>s</kbd>
          </button>
        {/if}
        {#if has.native}
          <button class="chip" onclick={() => play('native')}
            ><AudioLines size={15} /> Native speaker <kbd>n</kbd></button
          >
        {/if}
        {#if has.en}
          <button class="chip" onclick={cue}><Volume1 size={15} /> English <kbd>e</kbd></button>
        {/if}
        {#if !browsing && has.fr}
          <button
            class="chip flag"
            class:on={saidWrong}
            aria-pressed={saidWrong}
            onclick={() => (saidWrong = !saidWrong)}
          >
            <MicOff size={15} /> I said it wrong <kbd>p</kbd>
          </button>
        {/if}
      </div>
    {/if}
  </section>

  {#if past}
    <p class="muted tiny">
      {RUNG_LABEL[rung] ?? rung} · you answered <b>{RATING_NAME[past.rating]}</b>
    </p>
    <div class="grades nav">
      <button onclick={() => lookBack(-1)} disabled={back === 0}>
        <ChevronLeft size={16} /> Older <kbd>←</kbd>
      </button>
      <button onclick={() => lookBack(1)}>
        Newer <kbd>→</kbd>
      </button>
      <button class="primary" onclick={() => lookBack(history.length)}
        >Continue <kbd>space</kbd></button
      >
    </div>
  {:else if !revealed && !typing(rung)}
    <button class="primary wide" onclick={reveal}>Show <kbd>space</kbd></button>
  {:else if revealed}
    <div class="grades">
      <button onclick={() => record(1)} class="again" disabled={grading}
        >Again <kbd>1</kbd></button
      >
      <button onclick={() => record(2)} disabled={grading}>Hard <kbd>2</kbd></button>
      <button onclick={() => record(3)} disabled={grading}>Good <kbd>3</kbd></button>
      <button onclick={() => record(4)} class="easy" disabled={grading}
        >Easy <kbd>4</kbd></button
      >
    </div>
    {#if saveError}<p class="error small">{saveError}</p>{/if}
    {#if verdict}
      <p class="muted tiny">
        Suggested: {SUGGESTED_NAME[ratingFor(verdict.verdict)]}
      </p>
    {/if}

    {#if w.conj}
      <button
        class="forms-toggle"
        onclick={() => (showForms = !showForms)}
        aria-expanded={showForms}
      >
        {#if showForms}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if} Verb forms
      </button>
      {#if showForms}
        <section class="panel forms"><Conjugation conj={w.conj} /></section>
      {/if}
    {/if}
  {/if}
{/if}

<style>
  .lookback {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 4px;
  }
  .lookback button.link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .lookback button.link:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .dir {
    color: var(--muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin: 0 0 8px;
  }
  .task {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 13px;
    margin: 0 0 10px;
    color: var(--muted);
  }
  .task .verb {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink);
    font-weight: 500;
  }
  .task .arrow {
    opacity: 0.5;
  }
  .lang {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 3px 8px;
    border-radius: 999px;
    line-height: 1;
  }
  .lang.fr {
    background: var(--accent);
    color: var(--on-accent);
  }
  .lang.en {
    background: var(--ink);
    color: var(--bg);
  }
  .small {
    font-size: 12px;
  }
  .say-first {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 14px;
    color: var(--ink);
    margin-top: 4px;
  }
  .say-first .chip.primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .defs {
    width: 100%;
    text-align: left;
    margin-top: 6px;
    border-top: 1px solid var(--line);
    padding-top: 6px;
  }
  .defs-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    padding: 4px 0;
    cursor: pointer;
  }
  .def {
    list-style: none;
    margin: 4px 0 6px;
    padding: 0;
    font-size: 14.5px;
    line-height: 1.45;
  }
  .def li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 2px 0;
  }
  .en-line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    color: var(--muted);
  }
  .def .lang {
    flex: 0 0 auto;
    font-size: 10px;
    padding: 2px 6px;
  }
  .fr-def li {
    color: var(--ink);
  }
  .def:not(.fr-def) li {
    color: var(--muted);
  }
  .incomplete {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 13.5px;
    color: var(--warn);
    margin: 0;
  }
  .incomplete a {
    color: var(--warn);
  }
  .card-voice {
    width: 100%;
  }
  .notice {
    font-size: 13px;
    color: var(--good);
    background: var(--panel);
    border: 1px solid var(--good);
    border-radius: 10px;
    padding: 8px 12px;
    margin: 0 0 10px;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 22px 18px;
  }
  .card {
    min-height: 240px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 10px;
    text-align: center;
  }
  .prompt {
    font-size: 34px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .prompt.small {
    font-size: 24px;
  }
  .answer {
    font-size: 26px;
    font-weight: 650;
    color: var(--good);
  }
  .answer.fr {
    color: var(--ink);
  }
  .status {
    font-size: 18px;
    margin-top: 6px;
  }
  .sentence {
    font-size: 24px;
    line-height: 1.4;
    font-weight: 500;
  }
  .gap {
    display: inline-block;
    min-width: 3.2em;
    border-bottom: 2px solid var(--accent);
    color: var(--good);
    font-weight: 650;
  }
  .gap.filled {
    border-bottom-color: transparent;
  }
  .ipa {
    color: var(--ipa);
    font-size: 17px;
    font-family: Georgia, serif;
  }
  .alts {
    color: var(--muted);
    font-size: 14px;
  }
  .hint {
    color: var(--muted);
    font-size: 13px;
  }
  .verdict {
    font-size: 16px;
    font-weight: 650;
    color: var(--bad);
  }
  .verdict.ok {
    color: var(--good);
  }
  .speaker {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 10px;
    color: var(--accent);
  }
  .speaker .again {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .speaker:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: 12px;
  }
  .audio {
    display: flex;
    gap: 8px;
    margin-top: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .chip {
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 999px;
    font-weight: 500;
  }
  .chip.on {
    background: var(--warn);
    color: var(--on-warn);
    border-color: var(--warn);
  }
  .chip:disabled {
    opacity: 0.65;
    cursor: progress;
  }
  kbd {
    font:
      600 10.5px/1 ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1px 4px;
    margin-left: 6px;
    background: var(--bg);
    vertical-align: middle;
  }
  .chip.on kbd,
  button.primary kbd {
    color: inherit;
    border-color: rgba(255, 255, 255, 0.5);
    background: none;
  }
  @media (hover: none) and (pointer: coarse) {
    kbd {
      display: none;
    }
  }
  .forms-toggle {
    display: flex;
    justify-content: flex-start;
    width: 100%;
    margin-top: 12px;
    text-align: left;
    border: none;
    background: none;
    color: var(--accent);
    padding: 8px 4px;
    font-size: 14px;
  }
  .forms {
    padding: 14px;
    margin-top: 4px;
  }
  input {
    font: inherit;
    font-size: 20px;
    text-align: center;
    width: 100%;
    padding: 11px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
  }
  button {
    font: inherit;
    font-weight: 600;
    padding: 11px 16px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  button.wide {
    width: 100%;
    margin-top: 12px;
  }
  button.link {
    border: none;
    background: none;
    color: var(--muted);
    padding: 4px 0;
    font-weight: 400;
    font-size: 13px;
  }
  .grades {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-top: 12px;
  }
  .grades button {
    padding: 12px 4px;
    font-size: 13.5px;
  }
  .grades .again {
    color: var(--bad);
  }
  .grades.nav {
    grid-template-columns: 1fr 1fr 1.4fr;
  }
  .grades.nav button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .grades.nav button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .grades .easy {
    color: var(--good);
  }
  .done {
    text-align: center;
    gap: 10px;
  }
  .done h1 {
    font-size: 22px;
    margin: 0 0 6px;
  }
  .big {
    font-size: 26px;
    font-weight: 650;
    margin: 0;
  }
  .good {
    color: var(--good);
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 4px 0;
  }
  .muted {
    color: var(--muted);
  }
  .tiny {
    font-size: 12px;
    text-align: center;
  }
  .error {
    color: var(--bad);
  }
  .error.small {
    font-size: 13px;
    text-align: center;
    margin: 8px 0 0;
  }
</style>
