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
 */
import type { StoredCard } from './model.js';
import { MINUTE_MS, SECOND_MS, whenMs } from './units.js';
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
export function placeReturn<T extends { card: StoredCard }>(
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
