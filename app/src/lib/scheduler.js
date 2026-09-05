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
import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import { cardId, MATURE_STABILITY, PREREQ } from './keys.js';

export { Rating, State };

export function scheduler(settings) {
  return fsrs(generatorParameters({
    request_retention: settings.desiredRetention,
    enable_fuzz: true,
  }));
}

export function emptyCard(key, direction, now = new Date()) {
  const c = createEmptyCard(now);
  c.id = cardId(key, direction);
  c.key = key;
  c.direction = direction;
  return c;
}

const FSRS_FIELDS = ['due', 'stability', 'difficulty', 'elapsed_days', 'scheduled_days',
  'reps', 'lapses', 'learning_steps', 'state', 'last_review'];

function toFsrs(card) {
  const out = {};
  for (const f of FSRS_FIELDS) out[f] = card[f];
  return out;
}

/** Apply a rating. Returns the updated card; the caller logs the review. */
export function grade(f, card, rating, now = new Date(), settings = {}) {
  const { card: next } = f.next(toFsrs(card), now, rating);
  const updated = { ...card, ...next };
  const threshold = settings.leechThreshold ?? 6;
  updated.leech = updated.lapses >= threshold;
  return updated;
}

export const isMature = (card) =>
  !!card && card.state === State.Review && card.stability >= MATURE_STABILITY;

export const isDue = (card, now = new Date()) => !!card && new Date(card.due) <= now;

/** A direction is open once its prerequisite is known. Speaking has no
 *  prerequisite, so hands-free practice works from the first session. */
export function isUnlocked(direction, cardsForWord) {
  const prereq = PREREQ[direction];
  if (!prereq) return true;
  return isMature(cardsForWord?.[prereq]);
}

/** Share of recent reviews answered correctly, over cards that were already
 *  being reviewed. First exposures are not a memory test, so they are excluded. */
export function retention(reviews) {
  const real = reviews.filter(
    (r) => r.state === State.Review || r.state === State.Relearning);
  if (real.length < 20) return null;         // too little evidence to act on
  const good = real.filter((r) => r.rating >= Rating.Good).length;
  return good / real.length;
}

/** How many new words today. Derived from leftover capacity, then throttled by
 *  how much you have been forgetting. */
export function newAllowance({ dueCount, retention7d, settings, introducedToday = 0 }) {
  const capacity = settings.targetReviews - dueCount;
  const ceiling = settings.maxNewPerDay - introducedToday;
  /* Clamp to the daily ceiling first. Throttling before the clamp did nothing
     on a quiet day, because halving a number well above the ceiling still
     landed on the ceiling. */
  let n = Math.min(Math.floor(capacity / settings.costPerNewWord), ceiling);
  if (retention7d !== null && retention7d !== undefined) {
    if (retention7d < 0.85) n = 0;
    else if (retention7d < 0.9) n = Math.floor(n / 2);
  }
  return Math.max(0, n);
}

/** Explains the number above, for the screen that shows it. */
export function allowanceReason({ dueCount, retention7d, settings, allowance }) {
  if (settings.maxNewPerDay <= 0) return 'new words are switched off';
  if (retention7d !== null && retention7d !== undefined && retention7d < 0.85)
    return `holding off on new words: ${Math.round(retention7d * 100)}% recall this week`;
  if (dueCount >= settings.targetReviews)
    return `no room today: ${dueCount} reviews already due`;
  if (allowance >= settings.maxNewPerDay) return 'at your daily ceiling';
  return `${dueCount} due leaves room for ${allowance}`;
}

/** Old words that are not due yet, chosen so the common ones stay warm.
 *  Slightly wasteful by strict spacing theory, and the point is that a word you
 *  never meet between long intervals feels gone even when the schedule says it
 *  is fine. */
export function pickRefresher(cards, { now = new Date(), count, weightOf }) {
  if (count <= 0) return [];
  const pool = cards.filter((c) => isMature(c) && !isDue(c, now));
  if (!pool.length) return [];
  const scored = pool.map((c) => {
    const days = c.last_review ? (now - new Date(c.last_review)) / 86400000 : 999;
    return { c, score: days * (weightOf ? weightOf(c.key) : 1) * (0.5 + Math.random()) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((s) => s.c);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build one sitting.
 *
 *  Words from a tutoring lesson come before mined ones, so a lesson simply
 *  pauses the catalogue for a day or two rather than competing with it.
 */
export function assembleSession({ due, newItems, refresher, settings }) {
  const limit = settings.sessionLimit ?? 60;
  const reviews = shuffle([...due, ...refresher]).slice(0, limit);
  const fresh = newItems.slice(0, Math.max(0, limit - reviews.length));
  if (!fresh.length) return reviews;
  if (!reviews.length) return fresh;

  /* Spread new words evenly instead of stacking them at one end. */
  const out = [];
  const gap = reviews.length / fresh.length;
  let next = 0;
  reviews.forEach((item, i) => {
    while (next < fresh.length && i >= Math.floor(next * gap)) out.push(fresh[next++]);
    out.push(item);
  });
  while (next < fresh.length) out.push(fresh[next++]);
  return out;
}
