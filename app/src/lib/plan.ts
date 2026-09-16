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
 */
import type { LadderCard, StoredCard } from './model.js';
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
