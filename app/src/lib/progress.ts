/** What today looked like.
 *
 *  The review log is the only honest record of a day: cards hold the current
 *  state, but the state cannot say when you did the work, how long it took, or
 *  what you got wrong on the way. Everything here is read back out of the log,
 *  which is append-only, so a day never changes after it has happened.
 *
 *  A day is a local day, and it turns at the hour the learner set rather
 *  than at midnight — three in the morning unless they say otherwise — so a
 *  sitting at half past midnight is the evening's, as it feels, and not the
 *  first of a new day on a UTC clock or on the wall's.
 */
import { Rating, State } from 'ts-fsrs';
import type { CardId, WordKey } from './keys.js';
import type { Review, Settings, StoredCard } from './model.js';
import { newAllowance } from './scheduler.js';
import { DAY_MS, msOf as msOfSeconds, whenMs } from './units.js';
import type { Millis } from './units.js';

/** @deprecated Use DAY_MS from units.js; kept because a day's length reads
 *  naturally here and several screens import it by this name. */
export const DAY = DAY_MS;

/** The hour the day turns when the learner has not said: three in the
 *  morning. A day that turned at midnight cut a late sitting in two, the
 *  answers after twelve counted as a new day's and the tally started again
 *  under the learner's hands (#70). */
export const DEFAULT_DAY_STARTS_AT = 3;

/** The hour the day turns, as a whole hour in 0–23. A stored value that is
 *  not one — a hand-edit, a fraction typed into the dial — turns the day at
 *  the default rather than nowhere; this is the one place that decides. */
function trustHour(startsAt: number): number {
  return Number.isFinite(startsAt) && startsAt >= 0 && startsAt < 24
    ? Math.floor(startsAt) : DEFAULT_DAY_STARTS_AT;
}

/** When the day that `at` belongs to began: the most recent `startsAt`
 *  o'clock at or before `at`, in milliseconds. At half past two with the day
 *  turning at three, that is three o'clock *yesterday*; at three exactly it
 *  is today's.
 *
 *  The hour is on the local clock, so the day turns when the learner's clock
 *  says so, wherever they are and whatever the offset does in spring and
 *  autumn — a day may be twenty-three or twenty-five hours long, and it still
 *  begins at the hour. `startsAt` is `Settings.dayStartsAt`, passed in by
 *  hand rather than defaulted, because every "today" on every screen has to
 *  turn at the same hour; a caller quietly given midnight would disagree with
 *  the rest. Zero is midnight, the boundary the app once had.
 */
export function dayStart(at: Date, startsAt: number): Millis {
  const d = new Date(at);
  d.setHours(trustHour(startsAt), 0, 0, 0);
  /* Before the hour, the day began at that hour the calendar day before:
     stepped by the calendar and not by 24 hours, so the hour holds across a
     clock change. */
  if (d.getTime() > at.getTime()) d.setDate(d.getDate() - 1);
  return d.getTime() as Millis;
}

/** The start of the day `n` days on from the one starting at `day` — before
 *  it, for a negative `n` — by the calendar: adding `n * DAY_MS` lands an
 *  hour off across a clock change and matches no day at all. */
function daysFrom(day: Millis, n: number): Millis {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d.getTime() as Millis;
}

/** The log stores seconds; everything on screen is milliseconds. */
const msOf = (review: Pick<Review, 'ts'>): Millis => msOfSeconds(review.ts);

/** A review that tested a memory, as opposed to introducing one. First
 *  exposures are not a test, so they never count towards recall. */
const isRecall = (r: Pick<Review, 'state'>): boolean =>
  r.state === State.Review || r.state === State.Relearning;

/** Was this answer the first time the *word* was met?
 *
 *  Written down by the session at the moment it happens, because the card
 *  cannot say it afterwards: by then it has been answered. Rows from before
 *  that was recorded fall back to the card's state and the log behind it — a
 *  card seen for the first time, on a word with nothing before today — which
 *  is right except for a rung opened on a word met long ago.
 */
const isFirstMeeting = (r: Review, seenBefore: ReadonlySet<WordKey>): boolean =>
  ('met' in r ? (r.met ?? false) : r.state === State.New && !seenBefore.has(r.key));

/** Keys reviewed before `from`, so a first meeting can be told from a return.
 *
 *  Only as complete as the rows it is given: a caller holding a week of the
 *  log knows about a week. That is enough for rows that carry `met`, which is
 *  every row written since the session started recording it, and callers that
 *  need the older rows to be judged exactly pass `seenBefore` themselves —
 *  see `keysAnsweredBefore`, which answers it from the cards instead. */
function keysBefore(reviews: readonly Review[], from: Millis): Set<WordKey> {
  const out = new Set<WordKey>();
  for (const r of reviews) if (msOf(r) < from) out.add(r.key);
  return out;
}

/** Words with a card that was answered before `from` — the exact answer to
 *  "was this word already met", from the cards rather than from the log.
 *
 *  A card records only its last answer, which is why this cannot date a
 *  meeting; but "answered at all before today" is all a first meeting asks,
 *  and every rung of a word is looked at, so a rung opened today on a word
 *  known for weeks is correctly not a word met today. */
export function keysAnsweredBefore(
  cards: readonly StoredCard[], from: Millis,
): Set<WordKey> {
  const out = new Set<WordKey>();
  for (const c of cards) {
    if (c.last_review && whenMs(c.last_review) < from) out.add(c.key);
  }
  return out;
}

/** Words met for the first time on a day, in the order they were met.
 *
 *  The count the new-word allowance spends: a word that was introduced this
 *  morning must not be introduced again this afternoon, and the ceiling is a
 *  ceiling for the day rather than for each sitting.
 */
export function metOn(reviews: readonly Review[], {
  at = new Date(),
  seenBefore,
  dayStartsAt,
}: { at?: Date; seenBefore?: ReadonlySet<WordKey>; dayStartsAt: number }): WordKey[] {
  const from = dayStart(at, dayStartsAt);
  const to = daysFrom(from, 1);
  const before = seenBefore ?? keysBefore(reviews, from);
  const keys = new Set<WordKey>();
  for (const r of [...reviews].sort((a, b) => a.ts - b.ts)) {
    const ms = msOf(r);
    if (ms < from || ms >= to) continue;
    if (isFirstMeeting(r, before)) keys.add(r.key);
  }
  return [...keys];
}

/** The four grades, in the order a day reports them. */
export type RatingKey = 'again' | 'hard' | 'good' | 'easy';
export type RatingCounts = Record<RatingKey, number>;

/** One day as the log tells it. */
export interface DaySummary {
  date: Millis;
  reviews: number;
  ms: number;
  /** Minutes of answering, not of elapsed time. */
  minutes: number;
  /** Share of tested memories that held up, or null with nothing tested. */
  accuracy: number | null;
  recalled: number;
  counts: RatingCounts;
  /** Answers per hour of the local day. */
  hourly: number[];
  firstAt: Millis | null;
  lastAt: Millis | null;
  /** Words met for the first time, in the order they were met. */
  met: WordKey[];
  /** The cards that already existed and came back today, each once however
   *  many times relearning brought it round. Which ones and not how many:
   *  the finish line has to tell one card answered and owed again from two
   *  cards, and a count cannot (#48). */
  dueAnswered: ReadonlySet<CardId>;
  mispronounced: number;
  /** Null where the log of that day predates the count being written down. */
  learned: number | null;
  promoted: number | null;
  byDirection: { direction: string; reviews: number; right: number; recalled: number }[];
}

/** One bar of the fortnight chart. */
export interface DayBar { date: Millis; reviews: number; minutes: number }

/** How today compares with the days before it. */
export interface Comparison { mean: number; today: number; ratio: number | null }

/** The day's two halves: what was owed, and what there was room to gain. */
export interface DayContract {
  debt: { done: number; target: number; remaining: number };
  gain: { done: number; target: number; remaining: number };
  complete: boolean;
}

const RATINGS: { key: RatingKey; rating: Rating; label: string }[] = [
  { key: 'again', rating: Rating.Again, label: 'Again' },
  { key: 'hard', rating: Rating.Hard, label: 'Hard' },
  { key: 'good', rating: Rating.Good, label: 'Good' },
  { key: 'easy', rating: Rating.Easy, label: 'Easy' },
];

export const RATING_KEYS: RatingKey[] = RATINGS.map((r) => r.key);
export const RATING_LABEL: Record<RatingKey, string> =
  Object.fromEntries(RATINGS.map((r) => [r.key, r.label])) as Record<RatingKey, string>;

/** Everything one day's log has to say.
 *
 *  `learned` counts words that crossed into "known" during the day, which the
 *  session records at the moment it happens; it is null for a day whose reviews
 *  predate that being written down, because a count of zero would read as "you
 *  learned nothing today" rather than "nobody was counting".
 */
export function summariseDay({ reviews, at = new Date(), seenBefore, dayStartsAt }: {
  reviews: readonly Review[];
  at?: Date;
  seenBefore?: ReadonlySet<WordKey>;
  /** The hour the day turns: `Settings.dayStartsAt`. */
  dayStartsAt: number;
}): DaySummary {
  const from = dayStart(at, dayStartsAt);
  const to = daysFrom(from, 1);
  const today = reviews.filter((r) => msOf(r) >= from && msOf(r) < to)
    .sort((a, b) => a.ts - b.ts);
  const before = seenBefore ?? keysBefore(reviews, from);

  const counts: RatingCounts = { again: 0, hard: 0, good: 0, easy: 0 };
  const hourly: number[] = Array.from({ length: 24 }, () => 0);
  const byDirection: Record<string, { reviews: number; right: number; recalled: number }> = {};
  const seen = new Set<WordKey>();
  const owed = new Set<CardId>();
  const met: WordKey[] = [];
  let ms = 0;
  let recalled = 0;
  let right = 0;
  let learned = 0;
  let learnedKnown = false;
  let mispronounced = 0;
  let promoted = 0;
  let promotedKnown = false;

  for (const r of today) {
    const found = RATINGS.find((x) => x.rating === r.rating);
    if (found) counts[found.key] += 1;
    const hour = new Date(msOf(r)).getHours();
    hourly[hour] = (hourly[hour] ?? 0) + 1;
    ms += r.ms ?? 0;
    if (isRecall(r)) {
      recalled += 1;
      if (r.rating >= Rating.Good) right += 1;
    }
    if (isFirstMeeting(r, before) && !seen.has(r.key)) {
      seen.add(r.key);
      met.push(r.key);
    }
    if (r.state !== State.New) {
      /* A card that already existed and came back today: the day's debt,
         counted once however many times relearning brought it round. */
      owed.add(r.id);
    }
    if ('learned' in r) {
      learnedKnown = true;
      if (r.learned) learned += 1;
    }
    if (r.mispronounced) mispronounced += 1;
    if ('promoted' in r) {
      promotedKnown = true;
      if (r.promoted) promoted += 1;
    }
    const d = (byDirection[r.direction] ??= { reviews: 0, right: 0, recalled: 0 });
    d.reviews += 1;
    if (isRecall(r)) {
      d.recalled += 1;
      if (r.rating >= Rating.Good) d.right += 1;
    }
  }

  return {
    date: from,
    reviews: today.length,
    ms,
    /* Minutes of answering, not of elapsed time: a session with a break in the
       middle should not claim the break. */
    minutes: ms / 60000,
    accuracy: recalled ? right / recalled : null,
    recalled,
    counts,
    hourly,
    firstAt: today[0] ? msOf(today[0]) : null,
    lastAt: today.length ? msOf(today[today.length - 1]!) : null,
    met,
    dueAnswered: owed,
    mispronounced,
    learned: learnedKnown ? learned : null,
    /* Words that climbed a rung today. Like `learned`, null until the log
       started recording it: a zero would read as "nothing moved". */
    promoted: promotedKnown ? promoted : null,
    /* In first-seen order: whatever the rows call themselves, a rung or one
       of the old directions. */
    byDirection: Object.entries(byDirection).map(([direction, d]) => ({
      direction, reviews: d.reviews, right: d.right, recalled: d.recalled,
    })),
  };
}

/** One bar per day, oldest first, for the run-up to today. */
export function dailyCounts(reviews: readonly Review[], {
  days = 14, at = new Date(), dayStartsAt,
}: { days?: number; at?: Date; dayStartsAt: number }): DayBar[] {
  const today = dayStart(at, dayStartsAt);
  const out: DayBar[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push({ date: daysFrom(today, -i), reviews: 0, minutes: 0 });
  }
  const slot = new Map(out.map((d, i) => [d.date as number, i]));
  for (const r of reviews) {
    const i = slot.get(dayStart(new Date(msOf(r)), dayStartsAt));
    if (i === undefined) continue;
    out[i]!.reviews += 1;
    out[i]!.minutes += (r.ms ?? 0) / 60000;
  }
  return out;
}

/** Days in a row up to today with at least one review.
 *
 *  A day that has not been studied *yet* does not break the streak: at nine in
 *  the morning the answer should be the streak you are about to extend, not
 *  zero.
 */
export function streak(reviews: readonly Review[], {
  at = new Date(), dayStartsAt,
}: { at?: Date; dayStartsAt: number }): number {
  const days = new Set<number>(reviews.map((r) => dayStart(new Date(msOf(r)), dayStartsAt)));
  const today = dayStart(at, dayStartsAt);
  let n = 0;
  let day = days.has(today) ? today : daysFrom(today, -1);
  while (days.has(day)) {
    n += 1;
    day = daysFrom(day, -1);
  }
  return n;
}

/** How today compares with the days before it. Null until there is something
 *  to compare against, since "0% above average" on day one is noise. */
export function comparison(history: readonly DayBar[]): Comparison | null {
  const past = history.slice(0, -1).filter((d) => d.reviews > 0);
  if (past.length < 3) return null;
  const mean = past.reduce((n, d) => n + d.reviews, 0) / past.length;
  const today = history[history.length - 1]?.reviews ?? 0;
  return { mean, today, ratio: mean ? today / mean : null };
}

/** When the day is done.
 *
 *  Not a review count and not a clock. Two amounts the scheduler already
 *  knows: the debt — cards that were due, capped at what the day's minutes
 *  hold — and the gain, the new words there was room for. Both are set
 *  by the material rather than chosen, so getting better shrinks the first and
 *  grows the second, which is the direction a target should pay you in.
 *
 *  `owed` is what the day owes right now — plan.ts's `owedNow`, the same
 *  cards the home screen counts; `answeredToday` is the cards that already
 *  existed and were answered today (`summariseDay`); `metToday` is words seen
 *  for the first time. The day's debt is every card in either, counted once,
 *  so the plan stays put through the day instead of shrinking as you clear
 *  it. Counted once: a card graded Again is answered *and* owed again, and
 *  adding the two counts made it two cards — home said "1 due" while this
 *  said "1 of 2" with one card in the whole app (#48). A card owed again is
 *  not done either, so what is left here is what home says is due, as long
 *  as the day is not capped.
 */
export function dayContract({ owed, answeredToday, metToday, retention7d, settings, plan }: {
  owed: readonly Pick<StoredCard, 'id'>[];
  answeredToday: ReadonlySet<CardId>;
  metToday: number;
  retention7d: number | null;
  settings: Settings | null;
  /** The day in cards: its minutes over the pace (plan.ts). */
  plan: number;
}): DayContract | null {
  if (!settings) return null;
  const owedIds = new Set(owed.map((c) => c.id));
  const dueAtStart = new Set([...owedIds, ...answeredToday]).size;
  const cleared = [...answeredToday].filter((id) => !owedIds.has(id)).length;
  const debtTarget = Math.min(dueAtStart, plan);
  const debtDone = Math.min(cleared, debtTarget);
  const allowance = newAllowance({ dueCount: dueAtStart, retention7d, settings, plan });
  const gainDone = Math.min(metToday, allowance);
  return {
    debt: { done: debtDone, target: debtTarget, remaining: debtTarget - debtDone },
    gain: { done: gainDone, target: allowance, remaining: allowance - gainDone },
    complete: debtDone >= debtTarget && gainDone >= allowance,
  };
}

export function humanMinutes(minutes: number): string {
  if (!minutes) return '0 min';
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function clockTime(ms: Millis | null): string {
  return ms === null ? ''
    : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
