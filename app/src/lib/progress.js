/** What today looked like.
 *
 *  The review log is the only honest record of a day: cards hold the current
 *  state, but the state cannot say when you did the work, how long it took, or
 *  what you got wrong on the way. Everything here is read back out of the log,
 *  which is append-only, so a day never changes after it has happened.
 *
 *  A day is a local day. Studying at 23:50 and again at 00:10 is two days, as
 *  it feels, not one UTC block.
 */
import { Rating, State } from 'ts-fsrs';
import { newAllowance } from './scheduler.js';

export const DAY = 86400000;

/** Local midnight at or before `at`, in milliseconds. */
export function dayStart(at = new Date()) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The log stores seconds; everything on screen is milliseconds. */
const msOf = (review) => review.ts * 1000;

/** A review that tested a memory, as opposed to introducing one. First
 *  exposures are not a test, so they never count towards recall. */
const isRecall = (r) => r.state === State.Review || r.state === State.Relearning;

const RATINGS = [
  { key: 'again', rating: Rating.Again, label: 'Again' },
  { key: 'hard', rating: Rating.Hard, label: 'Hard' },
  { key: 'good', rating: Rating.Good, label: 'Good' },
  { key: 'easy', rating: Rating.Easy, label: 'Easy' },
];

export const RATING_KEYS = RATINGS.map((r) => r.key);
export const RATING_LABEL = Object.fromEntries(RATINGS.map((r) => [r.key, r.label]));

/** Everything one day's log has to say.
 *
 *  `learned` counts words that crossed into "known" during the day, which the
 *  session records at the moment it happens; it is null for a day whose reviews
 *  predate that being written down, because a count of zero would read as "you
 *  learned nothing today" rather than "nobody was counting".
 */
export function summariseDay({ reviews, at = new Date() }) {
  const from = dayStart(at);
  const to = from + DAY;
  const today = reviews.filter((r) => msOf(r) >= from && msOf(r) < to)
    .sort((a, b) => a.ts - b.ts);

  const counts = Object.fromEntries(RATING_KEYS.map((k) => [k, 0]));
  const hourly = Array.from({ length: 24 }, () => 0);
  const byDirection = {};
  const seen = new Set();
  const owed = new Set();
  const met = [];
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
    byDirection: Object.entries(byDirection)
      .map(([direction, d]) => ({ direction, ...d })),
  };
}

/** One bar per day, oldest first, for the run-up to today. */
export function dailyCounts(reviews, { days = 14, at = new Date() } = {}) {
  const today = dayStart(at);
  const out = [];
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

/** Days in a row up to today with at least one review.
 *
 *  A day that has not been studied *yet* does not break the streak: at nine in
 *  the morning the answer should be the streak you are about to extend, not
 *  zero.
 */
export function streak(reviews, at = new Date()) {
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

/** How today compares with the days before it. Null until there is something
 *  to compare against, since "0% above average" on day one is noise. */
export function comparison(history) {
  const past = history.slice(0, -1).filter((d) => d.reviews > 0);
  if (past.length < 3) return null;
  const mean = past.reduce((n, d) => n + d.reviews, 0) / past.length;
  const today = history[history.length - 1].reviews;
  return { mean, today, ratio: mean ? today / mean : null };
}

/** When the day is done.
 *
 *  Not a review count and not a clock. Two amounts the scheduler already
 *  knows: the debt — cards that were due, capped at what you said you are
 *  happy to do — and the gain, the new words there was room for. Both are set
 *  by the material rather than chosen, so getting better shrinks the first and
 *  grows the second, which is the direction a target should pay you in.
 *
 *  `reviewedToday` is distinct cards that already existed and were answered
 *  today; `metToday` is words seen for the first time. The morning's due count
 *  is reconstructed from what is still due plus what was answered, so the plan
 *  stays put through the day instead of shrinking as you clear it.
 */
export function dayContract({ dueRemaining, reviewedToday, metToday, retention7d, settings }) {
  if (!settings) return null;
  const dueAtStart = dueRemaining + reviewedToday;
  const debtTarget = Math.min(dueAtStart, settings.targetReviews ?? 0);
  const debtDone = Math.min(reviewedToday, debtTarget);
  const allowance = newAllowance({ dueCount: dueAtStart, retention7d, settings });
  const gainDone = Math.min(metToday, allowance);
  return {
    debt: { done: debtDone, target: debtTarget, remaining: debtTarget - debtDone },
    gain: { done: gainDone, target: allowance, remaining: allowance - gainDone },
    complete: debtDone >= debtTarget && gainDone >= allowance,
  };
}

export function humanMinutes(minutes) {
  if (!minutes) return '0 min';
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function clockTime(ms) {
  return ms === null ? '' : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
