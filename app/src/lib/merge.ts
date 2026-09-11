/** Merging two devices' data: reviews by set union, cards and words by last
 *  write. */
import { legacyToChannel, settleRungs } from './ladder';
import type {
  Card,
  CardId,
  Lesson,
  MergeCounts,
  Review,
  SyncPull,
  SyncPush,
  UserWord,
  WordKey,
} from './types';

/** Anything carrying the millisecond stamp the merge compares. */
export interface Timestamped {
  /** Milliseconds at the last local write. Absent counts as the beginning of
   *  time, so a row that has never been stamped always loses. */
  updatedAt?: number;
}

/** The later of two edits, preferring `a` on a tie and when `b` is missing.
 *  Used for words and anything else whose only ordering is when it was
 *  touched. */
export const newest = <T extends Timestamped>(a: T, b: T | undefined): T =>
  b && (b.updatedAt ?? 0) > (a?.updatedAt ?? 0) ? b : a;

/** When a card last moved, on either count: the newer of the local write stamp
 *  and the last review. Both are read because a card can be written without
 *  being answered — a re-key, a retirement — and answered on a device whose
 *  clock is behind. */
const lastMoved = (card: Card): number =>
  Math.max(card.updatedAt ?? 0, card.last_review ? new Date(card.last_review).getTime() : 0);

/** The card with the later answer wins, "later" being the newer of its local
 *  write stamp and its last review; on the same instant, the one that has seen
 *  more reviews. A side that is missing is returned as it stands. */
export function mergeCard(local: Card | undefined, remote: Card | undefined): Card | undefined {
  if (!local) return remote;
  if (!remote) return local;
  if (lastMoved(remote) > lastMoved(local)) return remote;
  if (lastMoved(local) > lastMoved(remote)) return local;
  return (remote.reps ?? 0) > (local.reps ?? 0) ? remote : local;
}

/** Last edit wins, tombstone included, so a deletion travels. */
export function mergeWord(
  local: UserWord | undefined,
  remote: UserWord | undefined,
): UserWord | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return newest(local, remote);
}

/** Union by `uid`, oldest answer first. The result does not depend on the
 *  order of the arguments, and merging the same rows twice changes nothing. */
export function mergeReviews(local: readonly Review[], remote: readonly Review[]): Review[] {
  const out = new Map<string, Review>();
  for (const r of local) out.set(r.uid, r);
  for (const r of remote) if (!out.has(r.uid)) out.set(r.uid, r);
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}

/** The device's own copies, as they stood when the round trip began. */
export interface LocalState {
  /** Every card on the device. */
  localCards: readonly Card[];
  /** Every word record, tombstones included. */
  localWords: readonly UserWord[];
  /** The whole review log. */
  localReviews: readonly Review[];
}

/** The rows a pull actually changed — the only ones worth writing back. */
export interface TouchedRows {
  /** Cards the pull advanced, or whose retirement the merge settled. */
  cards: Card[];
  /** Words the pull added or changed. */
  words: UserWord[];
}

/** A merged view of both sides, and what moved. */
export interface MergeResult {
  /** Every card, merged and with retirement settled. */
  cards: Card[];
  /** Every word, merged. */
  words: UserWord[];
  /** The whole log, merged and in order. */
  reviews: Review[];
  /** Just the rows that differ from the local copy. */
  touched: TouchedRows;
  /** How many rows of each kind came in, for the message the UI shows. */
  changed: MergeCounts;
}

/** Apply a pulled batch to local collections, settling retirement afterwards
 *  so one rung per channel is left active. `touched` is the subset of `cards`
 *  and `words` that differ from the local copy they were merged over — the
 *  ones worth writing back. Nothing is persisted here. */
export function applyPull(
  { localCards, localWords, localReviews }: LocalState,
  pull: SyncPull,
): MergeResult {
  const local = new Map<CardId, Card>(localCards.map((c) => [c.id, c]));
  const cards = new Map(local);
  let cardsChanged = 0;
  for (const raw of pull.cards ?? []) {
    const placed = legacyToChannel(raw);
    if (!placed) continue;
    const merged = mergeCard(cards.get(placed.id), placed);
    if (merged && merged !== cards.get(placed.id)) {
      cards.set(placed.id, merged);
      cardsChanged++;
    }
  }
  const localWordsByKey = new Map<WordKey, UserWord>(localWords.map((w) => [w.k, w]));
  const words = new Map(localWordsByKey);
  let wordsChanged = 0;
  for (const r of pull.words ?? []) {
    const merged = mergeWord(words.get(r.k), r);
    if (merged && merged !== words.get(r.k)) {
      words.set(r.k, merged);
      wordsChanged++;
    }
  }
  const before = localReviews.length;
  const reviews = mergeReviews(localReviews, pull.reviews ?? []);
  const settled = settleRungs([...cards.values()]);
  const wordList = [...words.values()];
  return {
    cards: settled,
    words: wordList,
    reviews,
    touched: {
      cards: settled.filter((c) => c !== local.get(c.id)),
      words: wordList.filter((w) => w !== localWordsByKey.get(w.k)),
    },
    changed: { cards: cardsChanged, words: wordsChanged, reviews: reviews.length - before },
  };
}

/** Everything this device holds, for the push to be cut from. */
export interface PushSource {
  /** Every card. */
  cards: readonly Card[];
  /** Every word record. */
  words: readonly UserWord[];
  /** The whole review log. */
  reviews: readonly Review[];
  /** Every lesson. */
  lessons?: readonly Lesson[];
}

/** What this device has that the server has not seen: cards, words and lessons
 *  stamped after `syncedAt`, and every review not yet marked `synced`.
 *
 *  @param syncedAt milliseconds at the start of the last sync; absent means
 *                  everything is unsent.
 */
export function collectPush(
  { cards, words, reviews, lessons }: PushSource,
  syncedAt: number | undefined,
): SyncPush {
  const since = syncedAt ?? 0;
  return {
    cards: cards.filter((c) => (c.updatedAt ?? 0) > since),
    words: words.filter((w) => (w.updatedAt ?? 0) > since),
    lessons: (lessons ?? []).filter((l) => (l.updatedAt ?? 0) > since),
    reviews: reviews.filter((r) => !r.synced),
  };
}
