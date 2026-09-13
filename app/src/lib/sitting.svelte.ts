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
 *  Nothing here plays a sound, focuses a box or sets a title: those are the
 *  screen's, and it is told when to do them by what these methods return.
 */
import { Rating } from 'ts-fsrs';
import { checkCloze, checkEnglish, checkFrench } from './check.js';
import type { Check } from './check.js';
import { TYPED } from './keys.js';
import type { Settings } from './model.js';
import { restoreHistory } from './queue.js';
import type { HistoryEntry, StudyItem, Tally } from './queue.js';
import { sentenceFor } from './cardface.js';
import type { Grade } from './scheduler.js';
import { answer, buildSession, forgetSitting, rememberSitting } from './session.js';
import type { AnswerResult } from './session.js';
import { nowMs } from './units.js';
import type { Millis } from './units.js';

const EMPTY_TALLY: Tally = { answered: 0, right: 0, learned: 0, promoted: 0, heard: 0 };

export class Sitting {
  /** The keyboard is taken away: only the rungs answered by speaking and
   *  tapping, the English read aloud. The same queue, not a different deck. */
  readonly walk: boolean;
  loading = $state(true);
  error = $state('');
  items = $state<StudyItem[]>([]);
  settings: Settings | null = null;
  /** Position in `items`: the live card. */
  i = $state(0);
  revealed = $state(false);
  typed = $state('');
  verdict = $state<Check | null>(null);
  /** Said aloud before the flip and it came out wrong. A flag beside the
   *  grade, never part of it: the grade is about the memory the card tests,
   *  and this is about a different one. */
  saidWrong = $state(false);
  /** This queue was left half-done and picked up again. */
  resumed = $state(false);
  done = $state<Tally>({ ...EMPTY_TALLY });
  /** Every card answered this sitting, oldest first, so you can look back at
   *  one you graded too quickly. Looking back changes nothing: the grade
   *  stands, and the live card waits where it was. */
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
  /** There is an older card to look back at. */
  canOlder = $derived(this.history.length > 0 && this.back !== 0);
  /** The live card is one whose answer is typed. */
  typing = $derived(!!this.current && TYPED.has(this.current.card.rung));

  private startedAt: Millis;
  private readonly now: () => Millis;

  constructor({ walk = false, now = nowMs }: { walk?: boolean; now?: () => Millis } = {}) {
    this.walk = walk;
    this.now = now;
    this.startedAt = now();
  }

  /** Deal the queue, or pick up the one left half-done. Resolves once there
   *  is a card or a reason there is none; `error` says which. */
  async start(): Promise<void> {
    try {
      const built = await buildSession({ handsFree: this.walk });
      this.items = built.items;
      this.settings = built.settings;
      /* Carried on from before a reload: the same queue, the same place in
         it, and the answers already given. The words themselves were looked
         up again on the way in, so a correction made since is on the card. */
      if (built.resumed) {
        this.i = built.resumed.i;
        this.done = { ...EMPTY_TALLY, ...built.resumed.done };
        this.history = restoreHistory(built.resumed.history, this.items);
        this.resumed = true;
      }
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
      this.startedAt = this.now();
    }
  }

  /** Turn the live card over. False when there was nothing to turn: it is
   *  already over, an answered card is on screen, or the card is a typed one,
   *  which is turned by `check` and never by looking. */
  reveal(): boolean {
    if (this.browsing || this.revealed || !this.current || this.typing) return false;
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
    if (!live || this.browsing || this.revealed || !TYPED.has(live.card.rung)) return false;
    const { word, card } = live;
    const sentence = card.rung === 'use' ? sentenceFor(live) : null;
    this.verdict = sentence ? checkCloze(this.typed, sentence.f)
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
   *  on, and the sitting is written down so a reload comes back here. What
   *  the answer did comes back for the screen to say; null when nothing was
   *  graded — an answered card on screen, one still being written, a card
   *  not yet turned. */
  async record(rating: Grade): Promise<AnswerResult | null> {
    const live = this.current;
    if (this.grading || this.browsing || !this.revealed || !live || !this.settings) return null;
    this.grading = true;
    let res: AnswerResult;
    try {
      res = await answer(live.card, live.word, rating, this.settings, this.now() - this.startedAt,
        { mispronounced: this.saidWrong });
    } finally {
      this.grading = false;
    }
    this.done.answered += 1;
    if (rating >= Rating.Good) this.done.right += 1;
    if (res.justLearned) this.done.learned += 1;
    if (res.promoted) this.done.promoted += 1;
    if (res.heardOpened) this.done.heard += 1;
    /* Anything you could not recall comes back before the session ends. */
    if (rating === Rating.Again) this.items = [...this.items, { ...live, card: res.card }];
    this.history = [...this.history,
      { item: live, rating, typed: this.typed, verdict: this.verdict }];
    this.i += 1;
    this.revealed = false;
    this.typed = '';
    this.verdict = null;
    this.saidWrong = false;
    this.startedAt = this.now();
    /* Written down after every answer, so a reload — or a phone reclaiming
       the tab — comes back to this card rather than dealing a new one. */
    if (this.i >= this.items.length) await forgetSitting();
    else {
      await rememberSitting({ items: this.items, i: this.i, walk: this.walk, done: this.done,
        history: this.history });
    }
    return res;
  }
}
