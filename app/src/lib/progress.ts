/** What today looked like, read back out of the review log. A day here is a
 *  local day, never a UTC block. */

/* The review log is the only honest record of a day: cards hold the current
   state, but the state cannot say when you did the work, how long it took, or
   what you got wrong on the way. The log is append-only, so a day never changes
   after it has happened.

   Studying at 23:50 and again at 00:10 is two days, as it feels. */
import { Rating, State } from 'ts-fsrs';
import type { Grade } from 'ts-fsrs';

import { newAllowance } from './scheduler';
import type { CardId, ExerciseName, Review, Settings, WordKey } from './types';

/** One day in milliseconds. */
export const DAY = 86400000;

/** Local midnight at or before `at`, in milliseconds. */
export function dayStart(at: Date | number = new Date()): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The log stores seconds; everything on screen is milliseconds. */
const msOf = (review: Pick<Review, 'ts'>): number => review.ts * 1000;

/** A review that tested a memory, as opposed to introducing one. First
 *  exposures are not a test, so they never count towards recall. */
const isRecall = (r: Pick<Review, 'state'>): boolean =>
  r.state === State.Review || r.state === State.Relearning;

/** The short name of a grading button. */
export type RatingKey = 'again' | 'hard' | 'good' | 'easy';

/** The four short names, weakest first — the order they are shown in. */
export const RATING_KEYS = [
  'again',
  'hard',
  'good',
  'easy',
] as const satisfies readonly RatingKey[];

/** What each button says on screen. */
export const RATING_LABEL: Record<RatingKey, string> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

/** The short name for a value FSRS was given, so a logged rating can be
 *  counted under the button that produced it. */
const KEY_BY_RATING: Record<Grade, RatingKey> = {
  [Rating.Again]: 'again',
  [Rating.Hard]: 'hard',
  [Rating.Good]: 'good',
  [Rating.Easy]: 'easy',
};

/** A day with nothing pressed yet. Written over rather than built by hand, so
 *  every key is present and no count reads back as undefined. */
const NO_COUNTS: Record<RatingKey, number> = { again: 0, hard: 0, good: 0, easy: 0 };

/** How one exercise went today. */
export interface DirectionTally {
  /** Which exercise, in whatever spelling the rows used. */
  direction: ExerciseName;
  /** Answers given. */
  reviews: number;
  /** Of the memory tests, how many were right. */
  right: number;
  /** How many of the answers were memory tests at all. */
  recalled: number;
}

/** Everything one day's log has to say. */
export interface DaySummary {
  /** Local midnight the day started at. */
  date: number;
  /** Answers given today, an "Again" counting each time it came round. */
  reviews: number;
  /** Milliseconds spent answering. */
  ms: number;
  /** Minutes of answering, not of elapsed time: a session with a break in the
   *  middle should not claim the break. */
  minutes: number;
  /** Share of memory tests answered Good or better, or null if there were
   *  none — which is not the same as none right. */
  accuracy: number | null;
  /** How many answers were memory tests rather than first exposures. */
  recalled: number;
  /** How many of each button were pressed. */
  counts: Record<RatingKey, number>;
  /** Answers per hour of the local day, 24 entries. */
  hourly: number[];
  /** Milliseconds of the first answer, or null on a day not studied. */
  firstAt: number | null;
  /** Milliseconds of the last answer, or null on a day not studied. */
  lastAt: number | null;
  /** Words met for the first time today, in the order they were met. */
  met: WordKey[];
  /** Distinct cards that already existed and came back today: the day's debt,
   *  counted once however many times relearning brought one round. */
  dueAnswered: number;
  /** Answers flagged as said wrong, whatever they were graded. */
  mispronounced: number;
  /** Words that crossed into "known" today, or null for a day whose reviews
   *  predate that being written down — a zero would read as "you learned
   *  nothing today" rather than "nobody was counting". */
  learned: number | null;
  /** Rungs climbed today; null for the same reason as `learned`. */
  promoted: number | null;
  /** One entry per exercise, in first-seen order. */
  byDirection: DirectionTally[];
}

/** Summarise the local day containing `at`. Rows outside it are ignored. */
export function summariseDay({
  reviews,
  at = new Date(),
}: {
  /** The whole log; it is filtered to the day here. */
  reviews: readonly Review[];
  /** Any moment in the day to summarise. */
  at?: Date;
}): DaySummary {
  /* `learned` counts words that crossed into "known" during the day, which the
     session records at the moment it happens; a day whose reviews predate that
     being written down reports null rather than zero, since zero would read as
     "you learned nothing today" rather than "nobody was counting". */
  const from = dayStart(at);
  const to = from + DAY;
  const today = reviews
    .filter((r) => msOf(r) >= from && msOf(r) < to)
    .sort((a, b) => a.ts - b.ts);

  const counts: Record<RatingKey, number> = { ...NO_COUNTS };
  const hourly = Array.from({ length: 24 }, () => 0);
  const byDirection = new Map<ExerciseName, Omit<DirectionTally, 'direction'>>();
  const seen = new Set<WordKey>();
  const owed = new Set<CardId>();
  let ms = 0;
  let recalled = 0;
  let right = 0;
  let learned = 0;
  let learnedKnown = false;
  let mispronounced = 0;
  let promoted = 0;
  let promotedKnown = false;
  const met: WordKey[] = [];

  for (const r of today) {
    const pressed = KEY_BY_RATING[r.rating];
    if (pressed) counts[pressed] += 1;
    hourly[new Date(msOf(r)).getHours()] += 1;
    ms += r.ms ?? 0;
    if (isRecall(r)) {
      recalled += 1;
      if (r.rating >= Rating.Good) right += 1;
    }
    if (r.state === State.New && !seen.has(r.key)) {
      seen.add(r.key);
      met.push(r.key);
    } else if (r.state !== State.New) {
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
    let d = byDirection.get(r.direction);
    if (!d) {
      d = { reviews: 0, right: 0, recalled: 0 };
      byDirection.set(r.direction, d);
    }
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
    firstAt: today.length ? msOf(today[0]) : null,
    lastAt: today.length ? msOf(today[today.length - 1]) : null,
    met,
    dueAnswered: owed.size,
    mispronounced,
    learned: learnedKnown ? learned : null,
    /* Words that climbed a rung today. Like `learned`, null until the log
       started recording it: a zero would read as "nothing moved". */
    promoted: promotedKnown ? promoted : null,
    /* In first-seen order: whatever the rows call themselves, a rung or one
       of the old directions. */
    byDirection: [...byDirection].map(([direction, d]) => ({ direction, ...d })),
  };
}

/** Words met for the first time on the local day of `at`, counted once each. */
export function metToday(reviews: readonly Review[], at: Date = new Date()): number {
  /* What the daily ceiling on new words is measured against: without it every
     fresh sitting dealt a full day's worth again. */
  const from = dayStart(at);
  const to = from + DAY;
  const keys = new Set<WordKey>();
  for (const r of reviews) {
    if (r.state === State.New && msOf(r) >= from && msOf(r) < to) keys.add(r.key);
  }
  return keys.size;
}

/** One bar of the fortnight chart. */
export interface DailyCount {
  /** Local midnight the day started at. */
  date: number;
  /** Answers given that day. */
  reviews: number;
  /** Minutes spent answering. */
  minutes: number;
}

/** One bar per day, oldest first, for the run-up to today. Days with nothing
 *  in them are present and zero, so the chart keeps its shape. */
export function dailyCounts(
  reviews: readonly Review[],
  { days = 14, at = new Date() }: { days?: number; at?: Date } = {},
): DailyCount[] {
  const today = dayStart(at);
  const out: DailyCount[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push({ date: today - i * DAY, reviews: 0, minutes: 0 });
  }
  const slot = new Map(out.map((d, i) => [d.date, i]));
  for (const r of reviews) {
    const i = slot.get(dayStart(new Date(msOf(r))));
    if (i === undefined) continue;
    out[i].reviews += 1;
    out[i].minutes += (r.ms ?? 0) / 60000;
  }
  return out;
}

/** Days in a row up to the day of `at` with at least one review. A today that
 *  has not been studied yet does not break the streak. */
export function streak(reviews: readonly Review[], at: Date = new Date()): number {
  /* At nine in the morning the answer should be the streak you are about to
     extend, not zero. */
  const days = new Set(reviews.map((r) => dayStart(new Date(msOf(r)))));
  const today = dayStart(at);
  let n = 0;
  let day = days.has(today) ? today : today - DAY;
  while (days.has(day)) {
    n += 1;
    day -= DAY;
  }
  return n;
}

/** Today against the days before it. */
export interface Comparison {
  /** Average answers on the past days that had any. */
  mean: number;
  /** Answers today. */
  today: number;
  /** Today over the mean, or null where the mean is zero. */
  ratio: number | null;
}

/** How the last day of `history` compares with the ones before it. Null until
 *  at least three earlier days have reviews. */
export function comparison(history: readonly DailyCount[]): Comparison | null {
  /* "0% above average" on day one is noise. */
  const past = history.slice(0, -1).filter((d) => d.reviews > 0);
  if (past.length < 3) return null;
  const mean = past.reduce((n, d) => n + d.reviews, 0) / past.length;
  const today = history[history.length - 1].reviews;
  return { mean, today, ratio: mean ? today / mean : null };
}

/** One half of the day's finish line: how much of a target has been met. */
export interface ContractPart {
  /** How much is done. Never more than the target. */
  done: number;
  /** How much the day asks for. */
  target: number;
  /** What is left, never negative. */
  remaining: number;
}

/** The day's finish line, as two amounts the scheduler already knows. */
export interface DayContract {
  /** Cards that were due, capped at what the learner is happy to do. */
  debt: ContractPart;
  /** New words there was room for. */
  gain: ContractPart;
  /** True once both are met. */
  complete: boolean;
}

/** The day's finish line, or null before the settings have been read. The
 *  morning's due count is reconstructed from what is still due plus what was
 *  answered, so the plan stays put through the day instead of shrinking as it
 *  is cleared. */
export function dayContract({
  dueRemaining,
  reviewedToday,
  metToday: met,
  retention7d,
  settings,
}: {
  /** Cards still due right now. */
  dueRemaining: number;
  /** Distinct already-existing cards answered today. */
  reviewedToday: number;
  /** Words met for the first time today. */
  metToday: number;
  /** Recall over the last week, or null when there is too little evidence. */
  retention7d: number | null;
  /** The budget and the ceiling; null before they have been read. */
  settings: Pick<Settings, 'targetReviews' | 'maxNewPerDay' | 'costPerNewWord'> | null;
}): DayContract | null {
  /* Not a review count and not a clock. Two amounts the scheduler already
     knows: the debt — cards that were due, capped at what you said you are
     happy to do — and the gain, the new words there was room for. Both are set
     by the material rather than chosen, so getting better shrinks the first and
     grows the second, which is the direction a target should pay you in. */
  if (!settings) return null;
  const dueAtStart = dueRemaining + reviewedToday;
  const debtTarget = Math.min(dueAtStart, settings.targetReviews ?? 0);
  const debtDone = Math.min(reviewedToday, debtTarget);
  const allowance = newAllowance({ dueCount: dueAtStart, retention7d, settings });
  const gainDone = Math.min(met, allowance);
  return {
    debt: { done: debtDone, target: debtTarget, remaining: debtTarget - debtDone },
    gain: { done: gainDone, target: allowance, remaining: allowance - gainDone },
    complete: debtDone >= debtTarget && gainDone >= allowance,
  };
}

/** Minutes the way a person would say them: "<1 min", "13 min", "1 h 35 min". */
export function humanMinutes(minutes: number): string {
  if (!minutes) return '0 min';
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A moment as a local clock time, or '' for the null that means "never". */
export function clockTime(ms: number | null): string {
  return ms === null
    ? ''
    : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
