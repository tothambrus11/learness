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
 */
import type { StoredCard } from './model.js';
import { whenMs } from './units.js';

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
