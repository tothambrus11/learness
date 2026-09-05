/** Merging two devices' data.
 *
 *  Three different shapes, three different rules:
 *
 *  * Reviews are an append-only log with a unique id per entry, so merging is a
 *    set union. Two phones can be offline for a week and neither loses a thing.
 *  * Card scheduling state is derived and cannot be replayed exactly (FSRS adds
 *    fuzz), so it is last-write-wins on the moment it was last answered.
 *  * Words you added are last-write-wins on when you edited them, with a
 *    tombstone so a deletion travels instead of being resurrected by the other
 *    device.
 */

export const newest = (a, b) => ((b?.updatedAt ?? 0) > (a?.updatedAt ?? 0) ? b : a);

/** Later answer wins. A card answered on your phone beats a stale copy on the
 *  laptop even if the laptop synced more recently. */
export function mergeCard(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const at = (c) => Math.max(
    c.updatedAt ?? 0,
    c.last_review ? new Date(c.last_review).getTime() : 0,
  );
  if (at(remote) > at(local)) return remote;
  if (at(local) > at(remote)) return local;
  /* Same instant: prefer whichever has seen more reviews. */
  return (remote.reps ?? 0) > (local.reps ?? 0) ? remote : local;
}

export function mergeWord(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  return newest(local, remote);
}

/** Union by id. Order does not matter and repeating a push is harmless. */
export function mergeReviews(local, remote) {
  const out = new Map();
  for (const r of local) out.set(r.uid, r);
  for (const r of remote) if (!out.has(r.uid)) out.set(r.uid, r);
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}

/** Apply a pulled batch to local collections. Returns what changed, so the UI
 *  can say "12 words and 340 reviews came in" rather than just "synced". */
export function applyPull({ localCards, localWords, localReviews }, pull) {
  const cards = new Map(localCards.map((c) => [c.id, c]));
  let cardsChanged = 0;
  for (const r of pull.cards ?? []) {
    const merged = mergeCard(cards.get(r.id), r);
    if (merged !== cards.get(r.id)) {
      cards.set(r.id, merged);
      cardsChanged++;
    }
  }
  const words = new Map(localWords.map((w) => [w.k, w]));
  let wordsChanged = 0;
  for (const r of pull.words ?? []) {
    const merged = mergeWord(words.get(r.k), r);
    if (merged !== words.get(r.k)) {
      words.set(r.k, merged);
      wordsChanged++;
    }
  }
  const before = localReviews.length;
  const reviews = mergeReviews(localReviews, pull.reviews ?? []);
  return {
    cards: [...cards.values()],
    words: [...words.values()],
    reviews,
    changed: { cards: cardsChanged, words: wordsChanged, reviews: reviews.length - before },
  };
}

/** What this device has that the server has not seen. */
export function collectPush({ cards, words, reviews, lessons }, syncedAt) {
  const since = syncedAt ?? 0;
  return {
    cards: cards.filter((c) => (c.updatedAt ?? 0) > since),
    words: words.filter((w) => (w.updatedAt ?? 0) > since),
    lessons: (lessons ?? []).filter((l) => (l.updatedAt ?? 0) > since),
    reviews: reviews.filter((r) => !r.synced),
  };
}
