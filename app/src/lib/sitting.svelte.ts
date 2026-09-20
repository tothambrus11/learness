/** One sitting, as state: the queue, where you are in it, which way up the
 *  card is, what has been typed, what has been answered, and what you are
 *  looking back at.
 *
 *  This used to be the study screen's own — a dozen `$state`s and the
 *  functions between them, in a Svelte page, which cannot be unit tested. It
 *  is the file most issues touched and the one with the fewest tests; the
 *  browser suite was the only thing that could see it. Here it is a class
 *  with rune state, so the screen reads it as it read its own variables and
 *  `tests/sitting.test.ts` drives it against the real database.
 *
 *  The queue is asked for on every open and is not written down; what is
 *  written down after every answer is the day — its tally and its answers —
 *  so coming back carries on with the same numbers and the same look-back,
 *  and with whatever the day now holds: a word added meanwhile is first.
 *
 *  Nothing here plays a sound, focuses a box or sets a title: those are the
 *  screen's, and it is told when to do them by what these methods return.
 */
import { Rating } from 'ts-fsrs';
import { checkChoice, checkCloze, checkEnglish, checkFrench } from './check.js';
import type { Check } from './check.js';
import { CHOSEN, STRICT, TYPED } from './keys.js';
import type { Settings } from './model.js';
import { DEFAULT_PACE_MS, placeReturn, SITTING_HORIZON_MS } from './plan.js';
import { dayStart } from './progress.js';
import { EMPTY_TALLY, keyOf, rungOf } from './queue.js';
import type { HistoryEntry, StudyItem, Tally } from './queue.js';
import { answerOf, sentenceFor } from './cardface.js';
import type { Grade } from './scheduler.js';
import { answer, buildSession, rememberDay } from './session.js';
import type { AnswerResult } from './session.js';
import { MINUTE_MS, nowMs, whenMs } from './units.js';
import type { Millis } from './units.js';
import type { WordKey } from './keys.js';
import { anyWord } from './words.js';

/** The sitting on screen, if one is. */
let onScreen: Sitting | null = null;
const show = (sitting: Sitting | null): void => { onScreen = sitting; };

/** A card is face up on the study screen: the moment a sync must not rewrite
 *  the card under it. False between cards, and off the screen. */
export const isStudying = (): boolean =>
  !!onScreen && onScreen.revealed && !onScreen.finished;

export class Sitting {
  loading = $state(true);
  error = $state('');
  items = $state<StudyItem[]>([]);
  /** Come back later than the queue is long; the end screen says when. */
  waiting = $state<StudyItem[]>([]);
  settings: Settings | null = null;
  /** Position in `items`: the live card. */
  i = $state(0);
  revealed = $state(false);
  typed = $state('');
  verdict = $state<Check | null>(null);
  /** On a card answered by tapping: every option tapped so far, in order.
   *  The first is the answer that is graded; a wrong one is taken away and
   *  the card asks again, which is the card teaching, not a second chance at
   *  the grade. Written into history as what was "typed", so a card looked
   *  back at says what was tapped first. */
  picked = $state<string[]>([]);
  /** Said aloud before the flip and it came out wrong. A flag beside the
   *  grade, never part of it: the grade is about the memory the card tests,
   *  and this is about a different one. */
  saidWrong = $state(false);
  /** Something was answered today before this open. */
  resumed = $state(false);
  done = $state<Tally>({ ...EMPTY_TALLY });
  /** Every card answered today, oldest first, so you can look back at one
   *  you graded too quickly. Looking back changes nothing: the grade stands,
   *  and the live card waits where it was. */
  history = $state<HistoryEntry[]>([]);
  /** Index into `history`, or null when the live card is on screen. */
  back = $state<number | null>(null);
  /** A second tap while the first answer is still being written would grade
   *  the same card twice and skip the next one. */
  grading = $state(false);

  browsing = $derived(this.back !== null);
  current = $derived(this.items[this.i] ?? null);
  left = $derived(this.items.length - this.i);
  finished = $derived(
    !this.loading && !this.error && (!this.items.length || this.i >= this.items.length));
  /* What is on screen: the live card, or the one being looked back at. */
  past = $derived(this.back === null ? null : this.history[this.back] ?? null);
  shown = $derived(this.past ? this.past.item : this.current);
  shownRevealed = $derived(this.browsing || this.revealed);
  shownTyped = $derived(this.past ? this.past.typed : this.typed);
  shownVerdict = $derived(this.past ? this.past.verdict : this.verdict);
  shownPicked = $derived(this.past ? (this.past.typed ? [this.past.typed] : []) : this.picked);
  /** There is an older card to look back at. */
  canOlder = $derived(this.history.length > 0 && this.back !== 0);
  /** The live card is one whose answer is typed. */
  typing = $derived.by((): boolean => { const r = rungOf(this.current); return !!r && TYPED.has(r); });
  /** The live card is one answered by tapping an option. */
  choosing = $derived.by((): boolean => { const r = rungOf(this.current); return !!r && CHOSEN.has(r); });
  /** Minutes until the first waiting card is due, at least one; null with
   *  nothing waiting. */
  backIn = $derived.by((): number | null => {
    if (!this.waiting.length) return null;
    const soonest = Math.min(...this.waiting.map((it) => whenMs(it.card.due)));
    return Math.max(1, Math.ceil((soonest - this.now()) / MINUTE_MS));
  });

  private startedAt: Millis;
  private readonly now: () => Millis;
  private paceMs = DEFAULT_PACE_MS;
  /** The start of the day the tally and history belong to: the hour the
   *  learner's day turns (`Settings.dayStartsAt`), not midnight. */
  private day: Millis = 0 as Millis;

  constructor({ now = nowMs }: { now?: () => Millis } = {}) {
    this.now = now;
    this.startedAt = now();
  }

  /** Deal today's queue, and pick up the day's tally and answers. Resolves
   *  once there is a card or a reason there is none; `error` says which. */
  async start(): Promise<void> {
    try {
      const at = this.now();
      const built = await buildSession({ now: new Date(at) });
      this.items = built.items;
      this.waiting = built.waiting;
      this.settings = built.settings;
      this.paceMs = built.paceMs;
      this.day = dayStart(new Date(at), built.settings.dayStartsAt);
      /* The day so far: the same numbers and the same look-back as before
         the screen was closed. The words themselves were looked up again on
         the way in, so a correction made since is on the card. */
      this.done = built.done;
      this.history = built.history;
      this.resumed = built.resumed;
      show(this);
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
      this.startedAt = this.now();
    }
  }

  /** The screen is going away: this is no longer the sitting on screen. */
  stop(): void {
    if (onScreen === this) show(null);
  }

  /** Look the word up again behind every card that carries it: the queue,
   *  the cards waiting to come back, and the day's answers. The words are
   *  resolved on the way in, so a correction made on the words screen was on
   *  the card at the next open and not before; one made from the card itself
   *  has to be on that card at once. Nothing else moves: the position, the
   *  face and what was typed stay as they are. A key nothing knows any more
   *  leaves every card as it was. */
  async refreshWord(key: WordKey): Promise<void> {
    const word = await anyWord(key);
    if (!word) return;
    const swap = (item: StudyItem): StudyItem =>
      (item.kind === 'word' && item.word.k === key ? { ...item, word } : item);
    this.items = this.items.map(swap);
    this.waiting = this.waiting.map(swap);
    this.history = this.history.map((h) => (keyOf(h.item) === key ? { ...h, item: swap(h.item) } : h));
  }

  /** Turn the live card over. False when there was nothing to turn: it is
   *  already over, an answered card is on screen, or the card is a typed one,
   *  which is turned by `check` and never by looking. */
  reveal(): boolean {
    if (this.browsing || this.revealed || !this.current || this.typing || this.choosing) return false;
    this.revealed = true;
    return true;
  }

  /** Tap an option on the live card. The first tap is graded; a wrong one is
   *  taken away and the question stands, so the card is answered by finding
   *  the right word rather than by being shown it — and finding it after a
   *  miss is still a miss on the record, which is what keeps a guess from
   *  lengthening an interval. True when the card turned over. */
  pick(option: string): boolean {
    const live = this.current;
    if (live?.kind !== 'word' || this.browsing || this.revealed || !this.choosing) return false;
    const want = answerOf(live);
    if (!want || this.picked.includes(option)) return false;
    this.picked = [...this.picked, option];
    if (option !== want) return false;
    this.verdict = checkChoice(this.picked[0], want);
    this.revealed = true;
    return true;
  }

  type(value: string): void {
    if (!this.browsing) this.typed = value;
  }

  /** Judge what was typed against the live card, and turn it over. False
   *  when there was nothing to check. */
  check(): boolean {
    const live = this.current;
    if (live?.kind !== 'word' || this.browsing || this.revealed || !TYPED.has(live.card.rung)) return false;
    const { word, card } = live;
    const sentence = card.rung === 'use' || card.rung === 'fill' ? sentenceFor(live) : null;
    this.verdict = sentence ? checkCloze(this.typed, sentence.f, { strict: STRICT.has(card.rung) })
      : card.rung === 'hear' ? checkEnglish(this.typed, word)
        : checkFrench(this.typed, word);
    this.revealed = true;
    return true;
  }

  flagSaid(): void {
    if (this.revealed && !this.browsing) this.saidWrong = !this.saidWrong;
  }

  /** Step back one card, further back, or forward to the live card again.
   *  Says where it landed: 'live' means the live card is on screen again and
   *  wants cueing; 'back' means an answered card is; null means nothing
   *  moved. */
  lookBack(step: number): 'live' | 'back' | null {
    const at = this.browsing ? this.back ?? 0 : this.history.length;
    const next = at + step;
    if (next < 0 || (next >= this.history.length && !this.browsing)) return null;
    if (next >= this.history.length) {
      /* Time spent looking back is not time spent on the live card. */
      this.back = null;
      this.startedAt = this.now();
      return 'live';
    }
    this.back = next;
    return 'back';
  }

  /** Grade the live card: the card and the log are written, the queue moves
   *  on, and the day is written down so coming back carries on from here.
   *  What the answer did comes back for the screen to say; null when nothing
   *  was graded — an answered card on screen, one still being written, a
   *  card not yet turned. */
  async record(rating: Grade): Promise<AnswerResult | null> {
    const live = this.current;
    if (this.grading || this.browsing || !this.revealed || live?.kind !== 'word' || !this.settings) return null;
    this.grading = true;
    let res: AnswerResult;
    try {
      res = await answer(live.card, live.word, rating, this.settings, this.now() - this.startedAt,
        { mispronounced: this.saidWrong });
    } finally {
      this.grading = false;
    }
    const at = this.now();
    /* Past the hour the day turns, this answer is the new day's first: the
       count starts again, and the look-back with it. The queue dealt is
       finished as dealt. */
    const today = dayStart(new Date(at), this.settings.dayStartsAt);
    if (today !== this.day) {
      this.day = today;
      this.done = { ...EMPTY_TALLY };
      this.history = [];
    }
    this.done.answered += 1;
    if (rating >= Rating.Good) this.done.right += 1;
    if (res.justLearned) this.done.learned += 1;
    if (res.promoted) this.done.promoted += 1;
    if (res.heardOpened) this.done.heard += 1;
    this.history = [...this.history,
      { item: live, rating, typed: this.picked[0] ?? this.typed, verdict: this.verdict }];
    this.i += 1;
    this.revealed = false;
    this.typed = '';
    this.picked = [];
    this.verdict = null;
    this.saidWrong = false;
    this.startedAt = at;
    /* A card that comes back within the sitting — a learning step, or
       anything you could not recall — is put where the pace says it falls:
       a minute away is a couple of cards away, ten minutes twenty-odd. It
       used to go to the end whatever the step said. A card retired by a
       climb does not come back; its next rung does, on the next open. */
    if (!res.card.retired && whenMs(res.card.due) - at <= SITTING_HORIZON_MS) {
      this.place({ ...live, card: res.card }, at);
    }
    this.settle(at);
    /* Plain copies, not the rune proxies: the structured clone the database
       makes refuses a proxy, and a record that did not save is a "Carry on"
       button that says "Study" — found by the browser suite after a typed
       answer, whose verdict is the object that made the row a proxy. */
    await rememberDay({
      day: this.day, done: $state.snapshot(this.done), history: $state.snapshot(this.history),
    });
    return res;
  }

  /** Into the queue, or onto the waiting list. */
  private place(item: StudyItem, at: Millis): void {
    const placed = placeReturn(this.items, this.i, item, { now: at, paceMs: this.paceMs });
    this.items = placed.queue;
    if (placed.held) this.waiting = [...this.waiting, item];
  }

  /** Give every waiting card another try: the queue may have grown, or the
   *  card may have fallen due. */
  private settle(at: Millis): void {
    const still: StudyItem[] = [];
    /* Latest due first, as session.ts places them, so two that both fall
       at the front come out earliest-due ahead. */
    for (const item of this.waiting.toReversed()) {
      const placed = placeReturn(this.items, this.i, item, { now: at, paceMs: this.paceMs });
      this.items = placed.queue;
      if (placed.held) still.unshift(item);
    }
    this.waiting = still;
  }
}
