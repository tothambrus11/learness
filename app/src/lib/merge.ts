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
 *    device. A theme you made or edited is the same shape and the same rule.
 *
 *  A card that arrives from before the ladder is placed on its rung on the way
 *  in, with the same mapper the local migration used, so an unmigrated device
 *  cannot reintroduce the old shape; and after any merge, one rung per channel
 *  is active — the highest — which every device derives for itself.
 */
import { legacyToChannel, settleRungs } from './ladder.js';
import type { CardId, WordKey } from './keys.js';
import type { Lesson, Review, StoredCard, UserWord } from './model.js';
import type { Theme } from './theme.js';
import { whenMs } from './units.js';
import type { Millis } from './units.js';

/** What one device has that the server has not seen. */
export interface Push {
  cards: StoredCard[];
  words: UserWord[];
  lessons: Lesson[];
  reviews: Review[];
  themes: Theme[];
}

/** What came back. Every field is optional: an older server may not send all
 *  of them, and a pull with nothing new sends none. */
export interface Pull {
  cards?: StoredCard[];
  words?: UserWord[];
  reviews?: Review[];
  themes?: Theme[];
}

/** The result of laying a pull over what is local. */
export interface Merged {
  cards: StoredCard[];
  words: UserWord[];
  reviews: Review[];
  themes: Theme[];
  changed: { cards: number; words: number; reviews: number; themes: number };
}

export const newest = <T extends { updatedAt?: Millis }>(a: T, b: T): T =>
  ((b?.updatedAt ?? 0) > (a?.updatedAt ?? 0) ? b : a);

/** Later answer wins. A card answered on your phone beats a stale copy on the
 *  laptop even if the laptop synced more recently. */
export function mergeCard(
  local: StoredCard | undefined,
  remote: StoredCard | undefined,
): StoredCard | undefined {
  if (!local) return remote;
  if (!remote) return local;
  const at = (c: StoredCard): number => Math.max(
    c.updatedAt ?? 0,
    c.last_review ? whenMs(c.last_review) : 0,
  );
  if (at(remote) > at(local)) return remote;
  if (at(local) > at(remote)) return local;
  /* Same instant: prefer whichever has seen more reviews. */
  return (remote.reps ?? 0) > (local.reps ?? 0) ? remote : local;
}

export function mergeWord(
  local: UserWord | undefined,
  remote: UserWord | undefined,
): UserWord | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return newest(local, remote);
}

/** The later edit wins, on either device; a tombstone is an edit like any
 *  other, so a theme deleted here is not brought back by a stale copy there. */
export function mergeTheme(
  local: Theme | undefined,
  remote: Theme | undefined,
): Theme | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return newest(local, remote);
}

/** Union by id. Order does not matter and repeating a push is harmless. */
export function mergeReviews(local: readonly Review[], remote: readonly Review[]): Review[] {
  const out = new Map<string, Review>();
  for (const r of local) out.set(r.uid, r);
  for (const r of remote) if (!out.has(r.uid)) out.set(r.uid, r);
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}

/** Apply a pulled batch to local collections. Returns what changed, so the UI
 *  can say "12 words and 340 reviews came in" rather than just "synced". */
export function applyPull(
  { localCards, localWords, localReviews, localThemes = [] }: {
    localCards: readonly StoredCard[];
    localWords: readonly UserWord[];
    localReviews: readonly Review[];
    localThemes?: readonly Theme[];
  },
  pull: Pull,
): Merged {
  const cards = new Map<CardId, StoredCard>(localCards.map((c) => [c.id, c]));
  let cardsChanged = 0;
  for (const raw of pull.cards ?? []) {
    const r = legacyToChannel(raw);
    if (!r) continue;                 /* a speaking card: retired, nothing to merge */
    const merged = mergeCard(cards.get(r.id), r);
    if (merged && merged !== cards.get(r.id)) {
      cards.set(r.id, merged);
      cardsChanged++;
    }
  }
  const words = new Map<WordKey, UserWord>(localWords.map((w) => [w.k, w]));
  let wordsChanged = 0;
  for (const r of pull.words ?? []) {
    const merged = mergeWord(words.get(r.k), r);
    if (merged && merged !== words.get(r.k)) {
      words.set(r.k, merged);
      wordsChanged++;
    }
  }
  const themes = new Map<string, Theme>(localThemes.map((t) => [t.id, t]));
  let themesChanged = 0;
  for (const r of pull.themes ?? []) {
    const merged = mergeTheme(themes.get(r.id), r);
    if (merged && merged !== themes.get(r.id)) {
      themes.set(r.id, merged);
      themesChanged++;
    }
  }
  const before = localReviews.length;
  const reviews = mergeReviews(localReviews, pull.reviews ?? []);
  return {
    cards: settleRungs([...cards.values()]),
    words: [...words.values()],
    reviews,
    themes: [...themes.values()],
    changed: {
      cards: cardsChanged, words: wordsChanged, reviews: reviews.length - before,
      themes: themesChanged,
    },
  };
}

/** What this device has that the server has not seen. */
export function collectPush(
  { cards, words, reviews, lessons, themes }: {
    cards: readonly StoredCard[];
    words: readonly UserWord[];
    reviews: readonly Review[];
    lessons?: readonly Lesson[];
    themes?: readonly Theme[];
  },
  syncedAt: Millis | undefined,
): Push {
  /* At or after: `syncedAt` is the moment the last sync read the store, and
     a record stamped in that same millisecond may have been written just
     after the read. Sending one the server has is harmless; it keeps the
     later of the two. */
  const since = syncedAt ?? 0;
  const fresh = (at: number | undefined): boolean => since === 0 || (at ?? 0) >= since;
  return {
    cards: cards.filter((c) => fresh(c.updatedAt)),
    words: words.filter((w) => fresh(w.updatedAt)),
    lessons: (lessons ?? []).filter((l) => fresh(l.updatedAt)),
    reviews: reviews.filter((r) => !r.synced),
    themes: (themes ?? []).filter((t) => fresh(t.updatedAt)),
  };
}
