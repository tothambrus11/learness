/** Scheduling: the FSRS instance, grading an answer, and how many new words a
 *  day may introduce. */
import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import type { FSRS, Grade } from 'ts-fsrs';

import { cardId, MATURE_STABILITY } from './keys';
import type { Card, Channel, Review, Rung, Settings, WordKey } from './types';

/** The library's rating and state enums, re-exported so callers need not
 *  depend on `ts-fsrs` directly. */
export { Rating, State };
/** A rating a learner can actually press: Again, Hard, Good or Easy. */
export type { Grade };

/** The dials the scheduler itself reads. A caller may pass the whole settings
 *  record; only this much is used. */
export type SchedulerSettings = Pick<Settings, 'desiredRetention'> &
  Partial<Pick<Settings, 'leechThreshold'>>;

/** An FSRS instance for the learner's retention target. It has no same-day
 *  learning steps, so a card is never due again on the day it was answered. */
export function scheduler(settings: SchedulerSettings): FSRS {
  /* ts-fsrs' default learning steps bring a card rated Good round again the
     same day; the empty step lists switch that off. */
  return fsrs(
    generatorParameters({
      request_retention: settings.desiredRetention,
      enable_fuzz: true,
      learning_steps: [],
      relearning_steps: [],
    }),
  );
}

/** A card on one rung of one channel, due now, knowing nothing yet. */
export function emptyCard(
  key: WordKey,
  channel: Channel,
  rung: Rung,
  now: Date = new Date(),
): Card {
  return {
    ...createEmptyCard(now),
    id: cardId(key, channel, rung),
    key,
    channel,
    rung,
    retired: false,
  };
}

/** The scheduling state FSRS owns, lifted off a card. Nothing the app added —
 *  the rung, the streak, the lesson label — is carried across. */
const toFsrs = (card: Card): Parameters<FSRS['next']>[0] => ({
  due: card.due,
  stability: card.stability,
  difficulty: card.difficulty,
  elapsed_days: card.elapsed_days,
  scheduled_days: card.scheduled_days,
  reps: card.reps,
  lapses: card.lapses,
  learning_steps: card.learning_steps,
  state: card.state,
  last_review: card.last_review,
});

/** Apply a rating and return the updated card; the caller logs the review. The
 *  card handed in is not touched, and the leech flag is recomputed from
 *  `lapses` rather than accumulated. The threshold defaults to 6. */
export function grade(
  f: FSRS,
  card: Card,
  rating: Grade,
  now: Date = new Date(),
  settings: Partial<Pick<Settings, 'leechThreshold'>> = {},
): Card {
  const { card: next } = f.next(toFsrs(card), now, rating);
  const updated: Card = { ...card, ...next };
  const threshold = settings.leechThreshold ?? 6;
  updated.leech = updated.lapses >= threshold;
  return updated;
}

/** What `isMature()` needs to answer: a card's state and its half-life. */
export type MaturityFields = Pick<Card, 'state' | 'stability'>;

/** True when the card is in review with a half-life of at least
 *  `MATURE_STABILITY` days — the one definition of "known" in the app. A card
 *  still in learning is never mature, however high its stability has climbed. */
export const isMature = (card: MaturityFields | null | undefined): boolean =>
  !!card && card.state === State.Review && card.stability >= MATURE_STABILITY;

/** What `isDue()` needs to answer. */
export type DueFields = Pick<Card, 'due'>;

/** True once the card has come round. Due exactly now counts as due. */
export const isDue = (card: DueFields | null | undefined, now: Date = new Date()): boolean =>
  !!card && new Date(card.due) <= now;

/** True when the answer tested a memory rather than introducing a word: the
 *  card was already in review or relearning when it was given. */
const isMemoryTest = (review: Pick<Review, 'state'>): boolean =>
  review.state === State.Review || review.state === State.Relearning;

/** Memory tests needed before their ratio is evidence rather than noise. */
const ENOUGH_TESTS = 20;

/** Share of the given reviews answered correctly, counting only cards that
 *  were already being reviewed. Null when there are fewer than
 *  `ENOUGH_TESTS` of those. */
export function retention(reviews: readonly Pick<Review, 'rating' | 'state'>[]): number | null {
  const tests = reviews.filter(isMemoryTest);
  if (tests.length < ENOUGH_TESTS) return null;
  const good = tests.filter((r) => r.rating >= Rating.Good).length;
  return good / tests.length;
}

/** What the daily new-word count is worked out from. */
export interface AllowanceInput {
  /** Cards already due today. Every one is work the day owes before anything
   *  new is added. */
  dueCount: number;
  /** Recall over the last week, or null when there is too little evidence. */
  retention7d: number | null | undefined;
  /** The budget and the ceiling. */
  settings: Pick<Settings, 'targetReviews' | 'maxNewPerDay' | 'costPerNewWord'>;
  /** Words already met for the first time today, so a second sitting is not
   *  offered the whole day's worth again. Defaults to zero. */
  introducedToday?: number;
}

/** How many new words today: leftover review capacity, capped by the daily
 *  ceiling, then halved below 90% recall and zeroed below 85%. Never
 *  negative. */
export function newAllowance({
  dueCount,
  retention7d,
  settings,
  introducedToday = 0,
}: AllowanceInput): number {
  const capacity = settings.targetReviews - dueCount;
  const ceiling = settings.maxNewPerDay - introducedToday;
  let n = Math.min(Math.floor(capacity / settings.costPerNewWord), ceiling);
  if (retention7d !== null && retention7d !== undefined) {
    if (retention7d < 0.85) n = 0;
    else if (retention7d < 0.9) n = Math.floor(n / 2);
  }
  return Math.max(0, n);
}

/** Explains the number above, for the screen that shows it. One sentence, in
 *  the order the reasons actually bind. */
export function allowanceReason({
  dueCount,
  retention7d,
  settings,
  allowance,
}: Omit<AllowanceInput, 'introducedToday'> & { allowance: number }): string {
  if (settings.maxNewPerDay <= 0) return 'new words are switched off';
  if (retention7d !== null && retention7d !== undefined && retention7d < 0.85) {
    return `holding off on new words: ${Math.round(retention7d * 100)}% recall this week`;
  }
  if (dueCount >= settings.targetReviews)
    return `no room today: ${dueCount} reviews already due`;
  if (allowance >= settings.maxNewPerDay) return 'at your daily ceiling';
  return `${dueCount} due leaves room for ${allowance}`;
}

/** The least a card must carry to be considered as a refresher. */
export type RefresherCard = MaturityFields & DueFields & Pick<Card, 'key' | 'last_review'>;

/** How the refresher picks. */
export interface RefresherOptions {
  /** The moment to judge due-ness against. */
  now?: Date;
  /** How many to return. Zero or less returns nothing. */
  count: number;
  /** Relative weight for a word, by key: higher means keep it warmer.
   *  Omitted, every word weighs the same. */
  weightOf?: (key: WordKey) => number;
}

/** Old words that are not due yet, chosen so the common ones stay warm: at
 *  most `count` cards, favouring the long unseen, randomised so two sittings
 *  in a row do not offer the same handful. The caller's own card type comes
 *  back. */
export function pickRefresher<T extends RefresherCard>(
  cards: readonly T[],
  { now = new Date(), count, weightOf }: RefresherOptions,
): T[] {
  if (count <= 0) return [];
  const pool = cards.filter((c) => isMature(c) && !isDue(c, now));
  if (!pool.length) return [];
  const scored = pool.map((c) => {
    const days = c.last_review
      ? (now.getTime() - new Date(c.last_review).getTime()) / 86400000
      : 999;
    return { c, score: days * (weightOf ? weightOf(c.key) : 1) * (0.5 + Math.random()) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((s) => s.c);
}

/** A copy of `list` in a random order. Fisher-Yates, so every ordering is
 *  equally likely; the input is left alone. */
function shuffle<T>(list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** As many of `items` as `room` allows, from the front. Empty when there is
 *  no room, so a caller may ask with whatever is left over. */
const upTo = <T>(items: readonly T[], room: number): T[] => items.slice(0, Math.max(0, room));

/** `fresh` spread evenly through `reviews` rather than stacked at one end.
 *  Either list may be empty, in which case the other is returned as it is. */
function interleave<T>(reviews: readonly T[], fresh: readonly T[]): T[] {
  const out: T[] = [];
  const gap = reviews.length / fresh.length;
  let next = 0;
  reviews.forEach((item, i) => {
    while (next < fresh.length && i >= Math.floor(next * gap)) out.push(fresh[next++]);
    out.push(item);
  });
  while (next < fresh.length) out.push(fresh[next++]);
  return out;
}

/** The four piles a sitting is built from, and how big it may be. */
export interface SessionInput<T> {
  /** Words the learner asked for. They come first, always. */
  first?: readonly T[];
  /** Cards that have come round. */
  due: readonly T[];
  /** Words never met before, in ranked order. */
  newItems: readonly T[];
  /** Old words kept warm, which only fill room the rest leave. */
  refresher?: readonly T[];
  /** How many cards one sitting may hold. */
  settings: Pick<Settings, 'sessionLimit'>;
}

/** Build one sitting: the words asked for first, then what is due, then the
 *  new words there is room for, and refreshers only in whatever room those
 *  leave. At most `settings.sessionLimit` cards, or 60 if it is unset. New
 *  words are spread through the sitting rather than stacked at one end. */
export function assembleSession<T>({
  first = [],
  due,
  newItems,
  refresher = [],
  settings,
}: SessionInput<T>): T[] {
  const limit = settings.sessionLimit ?? 60;
  const lesson = upTo(first, limit);
  const owed = upTo(shuffle(due), limit - lesson.length);
  const fresh = upTo(newItems, limit - lesson.length - owed.length);
  const warm = upTo(refresher, limit - lesson.length - owed.length - fresh.length);
  const reviews = warm.length ? shuffle([...owed, ...warm]) : owed;
  return [...lesson, ...interleave(reviews, fresh)];
}
