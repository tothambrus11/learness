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
import { trustWordKey } from './keys.js';
import type { BitState, Lesson, Review, StoredCard, UserWord } from './model.js';
import { RECORD_KINDS, kindOf, zeroCounts } from './kinds.js';
import type { Counts, RecordKind } from './kinds.js';
import type { Theme } from './theme.js';
import { trustMs, whenMs } from './units.js';
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
 *  of them, and a pull with nothing new sends none. Lessons were pushed and
 *  never pulled for a long while — the field was simply not here — so a
 *  lesson pasted on the phone had its words on the laptop and no label. */
export interface Pull {
  cards?: StoredCard[];
  words?: UserWord[];
  reviews?: Review[];
  lessons?: Lesson[];
  themes?: Theme[];
}

/** The result of laying a pull over what is local. */
export interface Merged {
  cards: StoredCard[];
  words: UserWord[];
  reviews: Review[];
  lessons: Lesson[];
  themes: Theme[];
  changed: Counts;
}

/** A lesson as it comes off the wire, made the app's record, or null for a
 *  record that is not one: the one place a pulled lesson is trusted. The id
 *  must be a string — the store was made with an auto-increment key before
 *  lessons had uuids, and a number from that time would be one device's
 *  count colliding with the other's. */
export function trustLesson(raw: unknown): Lesson | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.label !== 'string') return null;
  if (!Array.isArray(r.keys) || !r.keys.every((k) => typeof k === 'string')) return null;
  if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) return null;
  const addedAt = typeof r.addedAt === 'number' && Number.isFinite(r.addedAt)
    ? r.addedAt : r.updatedAt;
  return {
    id: r.id, label: r.label, keys: r.keys.map(trustWordKey),
    addedAt: trustMs(addedAt), updatedAt: trustMs(r.updatedAt),
  };
}

/** A bit as it comes off the wire, made the app's record, or null for a
 *  record that is not one: the one place a pulled bit is trusted. Validated
 *  and then spread, so a field a newer build added rides through an older
 *  one unharmed — a record survives a relay whole and should survive an
 *  edit whole too (GRAMMAR.md, "The records"). A row from before `v` reads
 *  as version 1, which is the only shape there has been. */
export function trustBit(raw: unknown): BitState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) return null;
  const openedAt = typeof r.openedAt === 'number' && Number.isFinite(r.openedAt)
    ? r.openedAt : r.updatedAt;
  return {
    ...r, id: r.id, openedAt: trustMs(openedAt), updatedAt: trustMs(r.updatedAt),
    deleted: !!r.deleted, v: typeof r.v === 'number' ? r.v : 1,
  };
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

/** The later edit wins, as for a word: a lesson is a label the learner gave
 *  a group of words, and the device that named it last is right. There is
 *  no tombstone, because nothing deletes a lesson yet. */
export function mergeLesson(
  local: Lesson | undefined,
  remote: Lesson | undefined,
): Lesson | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return newest(local, remote);
}

/** The later act wins, on either device: opened on the phone and closed on
 *  the laptop an hour later is closed, and the tombstone travels. */
export function mergeBit(
  local: BitState | undefined,
  remote: BitState | undefined,
): BitState | undefined {
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

/** How each record kind merges, by name: the one table the pull, the push
 *  and the write-back all read, so a kind added to kinds.ts without a merge
 *  rule here does not compile. Reviews are the log, and merge as a set. */
export const RECORD_MERGE: {
  [K in RecordKind]: (local: Merged[K][number] | undefined, remote: Merged[K][number] | undefined)
    => Merged[K][number] | undefined
} = { cards: mergeCard, words: mergeWord, lessons: mergeLesson, themes: mergeTheme };

/** The record's identity, read off it by the kind's key (kinds.ts). */
export const identityOf = (kind: RecordKind, record: object): string =>
  String((record as Record<string, unknown>)[kindOf(kind).key]);

/** Apply a pulled batch to local collections. Returns what changed, so the UI
 *  can say "12 words and 340 reviews came in" rather than just "synced". */
export function applyPull(
  { localCards, localWords, localReviews, localLessons = [], localThemes = [] }: {
    localCards: readonly StoredCard[];
    localWords: readonly UserWord[];
    localReviews: readonly Review[];
    localLessons?: readonly Lesson[];
    localThemes?: readonly Theme[];
  },
  pull: Pull,
): Merged {
  const local: { [K in RecordKind]: readonly Merged[K][number][] } = {
    cards: localCards, words: localWords, lessons: localLessons, themes: localThemes,
  };
  const changed = zeroCounts();
  const merged = {} as { [K in RecordKind]: Merged[K] };
  for (const kind of RECORD_KINDS) {
    const byId = new Map<string, Merged[typeof kind][number]>(
      local[kind].map((r) => [identityOf(kind, r), r]));
    const merge = RECORD_MERGE[kind] as (a: unknown, b: unknown) => Merged[typeof kind][number] | undefined;
    for (const raw of pull[kind] ?? []) {
      /* A card that arrives from before the ladder is placed on its rung on
         the way in, with the same mapper the local migration used; a speaking
         card maps to nothing and is left out. */
      const r = kind === 'cards' ? legacyToChannel(raw as StoredCard) : raw;
      if (!r) continue;
      const id = identityOf(kind, r);
      const kept = merge(byId.get(id), r);
      if (kept && kept !== byId.get(id)) {
        byId.set(id, kept);
        changed[kind]++;
      }
    }
    (merged as Record<RecordKind, unknown[]>)[kind] = [...byId.values()];
  }
  const before = localReviews.length;
  const reviews = mergeReviews(localReviews, pull.reviews ?? []);
  changed.reviews = reviews.length - before;
  return {
    cards: settleRungs(merged.cards),
    words: merged.words,
    reviews,
    lessons: merged.lessons,
    themes: merged.themes,
    changed,
  };
}

/** What this device has that the server has not seen. */
export function collectPush(
  { cards, words, reviews, lessons = [], themes = [] }: {
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
  const stamped = <T extends { updatedAt?: Millis }>(all: readonly T[]): T[] =>
    all.filter((r) => fresh(r.updatedAt));
  return {
    cards: stamped(cards),
    words: stamped(words),
    lessons: stamped(lessons),
    reviews: reviews.filter((r) => !r.synced),
    themes: stamped(themes),
  };
}
