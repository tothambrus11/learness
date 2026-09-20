/** The day's plan, and the sitting dealt from it.
 *
 *  Nothing here is stored and nothing here is random. Given the active cards,
 *  the day's log, the settings and the clock, the same sitting comes out every
 *  time — which is what lets the queue be asked for on every open instead of
 *  being written down (queue.ts says why it used to be).
 *
 *  The rule for what comes first is not ours: Tabibian et al., PNAS 2019
 *  ("Enhancing human learning via spaced repetition optimization") show that
 *  under a review budget the optimal rate of reviewing an item is proportional
 *  to one minus its recall probability. FSRS already estimates that
 *  probability for every card that has been answered, so due cards are dealt
 *  in order of how likely they are to have been forgotten.
 *
 *  A card that FSRS brings back within the sitting — a learning step of a
 *  minute or ten — is placed by the pace of answering rather than at the end:
 *  a minute away is two cards away. That is Pimsleur's graduated interval
 *  recall (1967) as FSRS encodes it, and the queue being frozen used to lose
 *  it: a step due in ten minutes waited for the next sitting.
 *
 *  A fixed share of every sitting is exploration: one new card every few, your
 *  own words before the catalogue's. That is the shape of the bandit the
 *  tutoring literature settled on — Clement, Roy, Oudeyer & Lopes (2015,
 *  "Multi-Armed Bandits for Intelligent Tutoring Systems") keep a zone of
 *  proximal development and spend about a tenth to a fifth of picks on plain
 *  exploration — and it is a share of a bounded sitting rather than "all new
 *  words first" because Reddy, Labutov, Banerjee & Joachims (KDD 2016,
 *  "Unbounded Human Learning") show mastery collapsing once new items arrive
 *  faster than review capacity absorbs them. A lesson of forty words pasted in
 *  is met in batches, each word coming back within the sitting, not forty
 *  first meetings in a row.
 *
 *  And the day is minutes, not cards: how many you set aside for each weekday,
 *  against the pace your own answers have been taking, which the log knows to
 *  the millisecond. The FSRS simulator reasons about workload the same way,
 *  in minutes a day from per-answer costs. A short bus ride is just stopping
 *  early; a heavier Saturday is a number in settings.
 */
import type { LadderCard, Review, Schedule, Settings, StoredCard } from './model.js';
import { dayStart } from './progress.js';
import { isDue, State } from './scheduler.js';
import { atMs, DAY_MS, MINUTE_MS, msOf, SECOND_MS, whenMs } from './units.js';
import type { Millis } from './units.js';

/** How long one answer takes when nothing says otherwise: a middling card,
 *  read, thought about, graded. */
export const DEFAULT_PACE_MS = 25 * SECOND_MS;
/** How far ahead a card may fall due and still belong to this sitting. */
export const SITTING_HORIZON_MS = 30 * MINUTE_MS;
/** A return this close is dealt at the end rather than held for the next
 *  open: the first learning step is a minute, and "one card comes back in a
 *  minute" on the end screen is worse than seeing it. */
export const SOON_MS = 90 * SECOND_MS;

/** How many cards away a card that comes back at `dueMs` belongs: at least
 *  the next one, else the gap measured in answers. A card k away is dealt
 *  after k − 1 others. */
export function returnPosition(dueMs: Millis, nowMs: Millis, paceMs: number): number {
  return Math.max(1, Math.round((dueMs - nowMs) / paceMs));
}

/** Put a returning card into a queue whose next card is at `next`: k cards
 *  away lands at `next + k − 1`. Beyond the end it is appended if due within
 *  SOON_MS and otherwise held — `held` says so, and the caller keeps it for
 *  the end screen or a later try. Never twice: a card already at or after
 *  `next` stays where it is. The queue given is not touched. */
export function placeReturn<T extends { card: Pick<Schedule, 'due'> & { id: string } }>(
  queue: readonly T[], next: number, item: T,
  { now, paceMs }: { now: Millis; paceMs: number },
): { queue: T[]; held: boolean } {
  if (queue.some((it, at) => at >= next && it.card.id === item.card.id)) {
    return { queue: [...queue], held: false };
  }
  const due = whenMs(item.card.due);
  const at = next + returnPosition(due, now, paceMs) - 1;
  if (at > queue.length) {
    return due - now <= SOON_MS
      ? { queue: [...queue, item], held: false }
      : { queue: [...queue], held: true };
  }
  const out = [...queue];
  out.splice(at, 0, item);
  return { queue: out, held: false };
}

/** Two ids in one order on every device: plain code-unit comparison, never
 *  the locale's, which differs by phone. */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Due cards, the likeliest forgotten first: ascending recall probability,
 *  then the earliest due, then the id — so two cards in the same state are
 *  dealt the same way round on every device and every open. `rOf` decides the
 *  recall; scheduler.ts's `retrievability` is the one that is meant, and it
 *  says a card never answered is 0, which puts a fresh rung ahead of every
 *  tested one. The input is not touched. */
export function orderByForgetting<T extends StoredCard>(
  cards: readonly T[], rOf: (card: T) => number,
): T[] {
  return cards
    .map((c) => ({ c, r: rOf(c), due: whenMs(c.due) }))
    .sort((a, b) => a.r - b.r || a.due - b.due || byId(a.c.id, b.c.id))
    .map((x) => x.c);
}

export interface PlanInput {
  /** Cards one open of the study screen deals, at most — save that your own
   *  due words are never cut, so a heavy day of them can run over. */
  capacity: number;
  /** One new card every this many cards. Never under two. */
  exploreEvery: number;
  /** Due now, the likeliest forgotten first (orderByForgetting), not counting
   *  your own words that have never been answered. */
  due: readonly LadderCard[];
  /** Your own words never answered, in the order you added them. */
  ownNew: readonly LadderCard[];
  /** The catalogue's next words, already cut to the day's allowance. */
  catalogueNew: readonly LadderCard[];
  /** Known words worth keeping warm, most wanted first. Dealt last and cut first. */
  refresher: readonly LadderCard[];
  /** From your own list: never cut for room. */
  isOwn: (card: LadderCard) => boolean;
}

/** One sitting, dealt.
 *
 *  The new cards take every `exploreEvery`th place, the first place included,
 *  so an open with a new word to deal starts with it; your own words fill
 *  those places before the catalogue's, and the ones beyond this open's
 *  places wait for the next, in order. With nothing to interleave them with,
 *  new cards come one after another. The due cards fill the rest, in the
 *  order given, and when more is due than fits, the catalogue's are dropped
 *  from the bottom — the best remembered — while your own all stay. What room
 *  is left after that goes to the refreshers.
 */
export function planSitting({
  capacity, exploreEvery, due, ownNew, catalogueNew, refresher, isOwn,
}: PlanInput): LadderCard[] {
  const every = Math.max(2, Math.floor(exploreEvery));
  const room = Math.max(0, Math.floor(capacity));
  const fresh = [...ownNew, ...catalogueNew];
  const places = fresh.length ? Math.ceil(room / every) : 0;
  const alone = due.length + refresher.length === 0;
  const newTaken = Math.min(fresh.length, alone ? room : places);

  const reviewRoom = Math.max(0, room - newTaken);
  const ownDue = due.filter(isOwn).length;
  const catalogueRoom = Math.max(0, reviewRoom - ownDue);
  const reviews: LadderCard[] = [];
  let catalogueTaken = 0;
  for (const c of due) {
    if (isOwn(c)) reviews.push(c);
    else if (catalogueTaken < catalogueRoom) { reviews.push(c); catalogueTaken += 1; }
  }
  reviews.push(...refresher.slice(0, Math.max(0, catalogueRoom - catalogueTaken)));

  const out: LadderCard[] = [];
  let r = 0;
  let n = 0;
  while (r < reviews.length || n < newTaken) {
    const explore = n < newTaken && (r >= reviews.length || out.length % every === 0);
    out.push(explore ? fresh[n++]! : reviews[r++]!);
  }
  return out;
}

/* ------------------------------------------------------------ the day -- */

/** Below this the "answers" were taps through a backlog; above it the phone
 *  was put down mid-card. Neither is a pace. */
export const PACE_FLOOR_MS = 5 * SECOND_MS;
export const PACE_CEILING_MS = 90 * SECOND_MS;
/** Answers with a time on them before the median is believed over the default. */
export const PACE_EVIDENCE = 20;
/** How far back the pace looks. */
export const PACE_WINDOW_MS = 14 * DAY_MS;
/** Minutes a day when nothing says otherwise, and when a stored value is of
 *  the wrong shape. */
export const DEFAULT_MINUTES = 20;

/** Milliseconds per answer, as the last fortnight of the log measured it: the
 *  median, so one long think on a "use it" card does not move it, clamped to
 *  the floor and ceiling above, and the default until there are PACE_EVIDENCE
 *  rows with a time on them. Rows with no time never count. */
export function paceOf(
  reviews: readonly Pick<Review, 'ts' | 'ms'>[],
  { now = new Date(), windowMs = PACE_WINDOW_MS }: { now?: Date; windowMs?: number } = {},
): number {
  const since = atMs(now) - windowMs;
  const times = reviews
    .filter((r) => msOf(r.ts) >= since && typeof r.ms === 'number' && r.ms > 0)
    .map((r) => r.ms as number)
    .sort((a, b) => a - b);
  if (times.length < PACE_EVIDENCE) return DEFAULT_PACE_MS;
  const mid = Math.floor(times.length / 2);
  const median = times.length % 2 ? times[mid]! : (times[mid - 1]! + times[mid]!) / 2;
  return Math.min(PACE_CEILING_MS, Math.max(PACE_FLOOR_MS, median));
}

/** The minutes set aside for `date`'s weekday, Monday first, as milliseconds.
 *  Zero is a real answer — no study on Sundays. A stored value of the wrong
 *  shape (an old row, a hand-edit) falls back to DEFAULT_MINUTES rather than
 *  to no plan at all. */
export function budgetFor(
  settings: Pick<Settings, 'minutesByWeekday'>, date: Date,
): number {
  const week: unknown = settings.minutesByWeekday;
  const minutes = Array.isArray(week) ? week[(date.getDay() + 6) % 7] : undefined;
  const ok = typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0;
  return (ok ? minutes : DEFAULT_MINUTES) * MINUTE_MS;
}

/** Milliseconds of answering in the log on the day that starts at `from`.
 *  Each answer counts for at most PACE_CEILING_MS, as it does in the pace: a
 *  card revealed before a forty-minute phone call is not forty minutes of
 *  answering, and it must not be the whole day's budget either. */
export function spentOn(
  reviews: readonly Pick<Review, 'ts' | 'ms'>[], from: Millis,
): number {
  let total = 0;
  for (const r of reviews) {
    const at = msOf(r.ts);
    if (at >= from && at < from + DAY_MS) total += Math.min(PACE_CEILING_MS, r.ms ?? 0);
  }
  return total;
}

/** What today holds. Everything the screens say about "how much" comes from
 *  here, so the home screen, the study screen and the progress page cannot
 *  disagree. */
export interface DayPlan {
  paceMs: number;
  budgetMs: number;
  spentMs: number;
  /** Never negative: past the plan there is simply nothing left. */
  remainingMs: number;
  /** The whole day in cards, at this pace: the allowance's capacity and the
   *  progress page's target. */
  size: number;
  /** The plan is spent: due cards still come, the catalogue's new words do not. */
  spent: boolean;
}

/** Cards in the middle of being learned: a step of a minute or ten. */
export const isLearning = (card: Pick<StoredCard, 'state'>): boolean =>
  card.state === State.Learning || card.state === State.Relearning;

/** What the day owes right now: every card that is due, and every learning
 *  step within the sitting's horizon, less your own words never answered —
 *  those are exploration, not debt. One rule, so the home screen's "N due",
 *  the progress page's finish line and the sitting's allowance cannot
 *  disagree; they did, once, each counting for itself. */
export function owedNow<T extends LadderCard>(cards: readonly T[], now: Date): T[] {
  const at = atMs(now);
  return cards.filter((c) => !(c.lesson && c.state === State.New)
    && (isDue(c, now) || (isLearning(c) && whenMs(c.due) <= at + SITTING_HORIZON_MS)));
}

export function dayPlan({ settings, reviews, now = new Date() }: {
  settings: Pick<Settings, 'minutesByWeekday' | 'dayStartsAt'>;
  reviews: readonly Pick<Review, 'ts' | 'ms'>[];
  now?: Date;
}): DayPlan {
  const paceMs = paceOf(reviews, { now });
  /* The day's start names the day: at one in the morning on a Tuesday the
     minutes are still Monday's, since it is still Monday's day. */
  const from = dayStart(now, settings.dayStartsAt);
  const budgetMs = budgetFor(settings, new Date(from));
  const spentMs = spentOn(reviews, from);
  const remainingMs = Math.max(0, budgetMs - spentMs);
  return {
    paceMs, budgetMs, spentMs, remainingMs,
    size: Math.round(budgetMs / paceMs),
    spent: remainingMs <= 0,
  };
}
