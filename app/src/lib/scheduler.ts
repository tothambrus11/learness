/** Scheduling.
 *
 *  FSRS rather than SM-2: it models a memory half-life per card and schedules
 *  against a retention target you choose, instead of multiplying an interval by
 *  a fixed ease. That matters for words you keep failing, which SM-2 pushes too
 *  far out.
 *
 *  The daily new-word count is derived, not set. You choose how much reviewing
 *  you want; whatever capacity is left becomes room for new words, and recent
 *  retention throttles it further. A week of forgetting slows intake on its own.
 */
import { atMs, DAY_MS, whenMs } from './units.js';
import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import type { CardInput, Grade } from 'ts-fsrs';
import { cardId, MATURE_STABILITY } from './keys.js';
import type { Channel, Rung, WordKey } from './keys.js';
import type { LadderCard, Review, Settings, StoredCard } from './model.js';

export { Rating, State };
export type { Grade };

/** The scheduler itself, configured from the learner's retention dial. */
export type Scheduler = ReturnType<typeof fsrs>;

export function scheduler(settings: Pick<Settings, 'desiredRetention'>): Scheduler {
  return fsrs(generatorParameters({
    request_retention: settings.desiredRetention,
    enable_fuzz: true,
  }));
}

/** A card on one rung of one channel, due now, knowing nothing yet. */
export function emptyCard(
  key: WordKey, channel: Channel, rung: Rung, now: Date = new Date(),
): LadderCard {
  return {
    ...createEmptyCard(now),
    id: cardId(key, channel, rung),
    key,
    channel,
    rung,
    retired: false,
  };
}

/** The fields ts-fsrs owns. Everything else on a card is ours and is carried
 *  across a grading untouched. */
const FSRS_FIELDS = ['due', 'stability', 'difficulty', 'elapsed_days', 'scheduled_days',
  'reps', 'lapses', 'learning_steps', 'state', 'last_review'] as const;

function toFsrs(card: StoredCard): CardInput {
  const out: Record<string, unknown> = {};
  for (const f of FSRS_FIELDS) out[f] = card[f];
  return out as unknown as CardInput;
}

/** Apply a rating. Returns the updated card; the caller logs the review. */
export function grade<T extends StoredCard>(
  f: Scheduler, card: T, rating: Grade, now: Date = new Date(),
  settings: Partial<Settings> = {},
): T {
  const { card: next } = f.next(toFsrs(card), now, rating);
  const updated = { ...card, ...next };
  const threshold = settings.leechThreshold ?? 6;
  updated.leech = updated.lapses >= threshold;
  return updated;
}

/** How likely the card is still remembered at `now`, 0..1, on FSRS's own
 *  forgetting curve. A card never answered is 0: nothing is known, so nothing
 *  is remembered — which is what puts a fresh rung ahead of every tested one
 *  when the due pile is ordered by the chance of forgetting (plan.ts). */
export function retrievability(f: Scheduler, card: StoredCard, now: Date = new Date()): number {
  if (card.state === State.New || !card.last_review) return 0;
  return f.get_retrievability(toFsrs(card), now, false);
}

export const isMature = (card: StoredCard | null | undefined): boolean =>
  !!card && card.state === State.Review && card.stability >= MATURE_STABILITY;

export const isDue = (card: StoredCard | null | undefined, now: Date = new Date()): boolean =>
  !!card && whenMs(card.due) <= atMs(now);

/** Share of recent reviews answered correctly, over cards that were already
 *  being reviewed. First exposures are not a memory test, so they are excluded. */
export function retention(reviews: readonly Review[]): number | null {
  const real = reviews.filter(
    (r) => r.state === State.Review || r.state === State.Relearning);
  if (real.length < 20) return null;         // too little evidence to act on
  const good = real.filter((r) => r.rating >= Rating.Good).length;
  return good / real.length;
}

/** How far the week's recall may fall under the recall you asked for before
 *  new words are halved, and before they stop, in whole percentage points.
 *
 *  Measured against the dial, not against 90%. The thresholds were 85% and
 *  90% in absolute terms, which meant a learner who set the dial to 85% — a
 *  reasonable place; the FSRS simulations put the optimum near it — was
 *  asking the scheduler to deliver exactly the recall that would halve their
 *  intake and stop it on any bad week. Whole points, because 0.9 − 0.05 is
 *  0.8500000000000001 to the machine, and a week at exactly 85% must not
 *  halve intake at the default dial. */
export const THROTTLE_HALVE_AT = 5;
export const THROTTLE_STOP_AT = 10;

/** Points of recall under the dial this week: positive is worse than asked. */
export function recallShortfall(
  settings: Pick<Settings, 'desiredRetention'>, retention7d: number,
): number {
  return Math.round((settings.desiredRetention - retention7d) * 100);
}

/** How many new words today. Derived from leftover capacity, then throttled by
 *  how much you have been forgetting, relative to how much you said you would. */
export function newAllowance({ dueCount, retention7d, settings, introducedToday = 0 }: {
  dueCount: number;
  retention7d: number | null;
  settings: Pick<Settings, 'targetReviews' | 'maxNewPerDay' | 'costPerNewWord' | 'desiredRetention'>;
  introducedToday?: number;
}): number {
  const capacity = settings.targetReviews - dueCount;
  /* The order of these three is the whole meaning of the number.
     Clamp to the day's ceiling first: throttling before the clamp did nothing
     on a quiet day, because halving a number well above the ceiling still
     landed on the ceiling.
     Throttle second, on the day's whole intake.
     Spend last. Subtracting what today has already met *before* the throttle
     would halve the remainder each sitting instead of the day — five short
     sittings on a shaky week added up to nineteen new words where one sitting
     would have given ten. */
  let n = Math.min(Math.floor(capacity / settings.costPerNewWord), settings.maxNewPerDay);
  if (retention7d !== null && retention7d !== undefined) {
    const under = recallShortfall(settings, retention7d);
    if (under >= THROTTLE_STOP_AT) n = 0;
    else if (under >= THROTTLE_HALVE_AT) n = Math.floor(n / 2);
  }
  return Math.max(0, n - introducedToday);
}

/** Explains the number above, for the screen that shows it. */
export function allowanceReason({ dueCount, retention7d, settings, allowance,
  introducedToday = 0 }: {
  dueCount: number;
  retention7d: number | null;
  settings: Pick<Settings, 'targetReviews' | 'maxNewPerDay' | 'desiredRetention'>;
  allowance: number;
  introducedToday?: number;
}): string {
  if (settings.maxNewPerDay <= 0) return 'new words are switched off';
  if (retention7d !== null && retention7d !== undefined
    && recallShortfall(settings, retention7d) >= THROTTLE_STOP_AT) {
    return `holding off on new words: ${Math.round(retention7d * 100)}% recall this week, `
      + `against the ${Math.round(settings.desiredRetention * 100)}% you asked for`;
  }
  /* The day's ceiling is spent, and saying so is the difference between "the
     app has stopped giving me words" and "that is today's intake done". */
  if (introducedToday >= settings.maxNewPerDay)
    return `today's ${settings.maxNewPerDay} new words are done`;
  if (dueCount >= settings.targetReviews)
    return `no room today: ${dueCount} reviews already due`;
  if (allowance >= settings.maxNewPerDay) return 'at your daily ceiling';
  if (introducedToday > 0)
    return `${introducedToday} met today, room for ${allowance} more`;
  return `${dueCount} due leaves room for ${allowance}`;
}

/** Old words that are not due yet, chosen so the common ones stay warm.
 *  Slightly wasteful by strict spacing theory, and the point is that a word you
 *  never meet between long intervals feels gone even when the schedule says it
 *  is fine. The longest unseen first, weighted; ties by id, so the same cards
 *  are asked for on every open. There used to be a dash of chance in the
 *  score, which was one of the two reasons a reload dealt a different card. */
export function pickRefresher<T extends StoredCard>(cards: readonly T[],
  { now = new Date(), count, weightOf }: {
    now?: Date;
    count: number;
    weightOf?: (key: WordKey) => number;
  }): T[] {
  if (count <= 0) return [];
  const pool = cards.filter((c) => isMature(c) && !isDue(c, now));
  if (!pool.length) return [];
  const scored = pool.map((c) => {
    const days = c.last_review ? (atMs(now) - whenMs(c.last_review)) / DAY_MS : 999;
    return { c, score: days * (weightOf ? weightOf(c.key) : 1) };
  });
  scored.sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
  return scored.slice(0, count).map((s) => s.c);
}
