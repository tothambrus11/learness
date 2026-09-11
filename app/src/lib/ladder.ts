/** How a word climbs: where it enters each channel, when it moves up, and when
 *  the heard channel opens. Every decision here is pure. */
import type { Grade } from 'ts-fsrs';

import { cardId, LEGACY_RUNG, LOOKS_FREE, RUNGS, SOUNDS_FREE } from './keys';
import { emptyCard, isMature, Rating } from './scheduler';
import type {
  Card,
  CatalogueEntry,
  Channel,
  LegacyDirection,
  Rung,
  StudyWord,
  WordKey,
} from './types';

/** How far up its ladder a rung sits, or -1 for a rung that channel has no
 *  place for. Comparing two indices is the only way rungs are ordered. */
export const rungIndex = (channel: Channel, rung: Rung): number =>
  (RUNGS[channel] as readonly Rung[])?.indexOf(rung) ?? -1;

/** The rung above, or null at the top. "Use it" needs a sentence to use it in,
 *  so it is skipped for a word that has none yet. */
export function nextRung(
  channel: Channel,
  rung: Rung,
  word: Pick<StudyWord, 'ex'> | null = null,
): Rung | null {
  const next = (RUNGS[channel] as readonly Rung[])?.[rungIndex(channel, rung) + 1] ?? null;
  if (next === 'use' && !word?.ex?.length) return null;
  return next;
}

/** The two similarity scores that decide where a word joins a ladder. Both
 *  are absent on a word the learner typed, which is why it starts at the
 *  bottom. */
export type EntryScores = Pick<CatalogueEntry, 'looks' | 'sounds'>;

/** Where a word starts on a channel: "write" at or above `LOOKS_FREE` and
 *  "recognise" below it, "dictate" at or above `SOUNDS_FREE` and "hear" below
 *  it. A word with no score starts at the bottom. */
export function entryRung(channel: Channel, word: EntryScores | null | undefined): Rung {
  if (channel === 'written') return (word?.looks ?? 0) >= LOOKS_FREE ? 'write' : 'recognise';
  return (word?.sounds ?? 0) >= SOUNDS_FREE ? 'dictate' : 'hear';
}

/** Good answers in a row before a rung is climbed. */
export const CLIMB_STREAK = 2;

/** The single answer that climbs a rung at once, without a streak. */
export const CLIMB_AT_ONCE = Rating.Easy;

/** The card's streak after an answer of `rating`: one more for Good or better,
 *  zero for anything below. */
export function streakAfter(card: Pick<Card, 'streak'>, rating: Grade): number {
  return rating >= Rating.Good ? (card.streak ?? 0) + 1 : 0;
}

/** Whether an answer of `rating` on a card, now carrying `streak`, climbs. */
export const climbs = (rating: Grade, streak: number): boolean =>
  rating >= CLIMB_AT_ONCE || streak >= CLIMB_STREAK;

/** A card as it was stored before the ladder existed: keyed by one of the five
 *  directions rather than by a channel and a rung. */
export type LegacyCard = Omit<Card, 'channel' | 'rung'> & {
  /** The old direction name. Present only on an unmigrated card. */
  direction?: LegacyDirection;
  /** Absent on a card from before the ladder; present once it has moved. */
  channel?: Channel;
  /** Absent on a card from before the ladder; present once it has moved. */
  rung?: Rung;
};

/** A card from before the ladder, placed on the rung its direction implies,
 *  or null for the speaking direction, which maps to no rung. Idempotent: a
 *  card already on a rung, or of no known shape, comes back unchanged. */
export function legacyToChannel(card: LegacyCard | Card | null | undefined): Card | null {
  if (!card) return null;
  const maybe = card as LegacyCard;
  if (maybe.channel && maybe.rung) return card as Card;
  if (!maybe.direction) return card as Card;
  const to = LEGACY_RUNG[maybe.direction];
  if (!to) return null;
  const [channel, rung] = to;
  const { direction: _direction, ...rest } = maybe;
  return { ...rest, id: cardId(maybe.key, channel, rung), channel, rung };
}

/** True when the card can be scheduled: it sits on a ladder and has not been
 *  overtaken by a higher rung of the same channel. */
export const isActive = (card: Partial<Card> | null | undefined): boolean =>
  !!card?.channel && !card.retired;

/** An old card and the re-keyed copy that should replace it. */
export type Rekey = readonly [from: Card, to: Card];

/** The one key each lemma is listed under, or null for a lemma the index lists
 *  more than once — where a re-key would be a guess rather than a rename. */
function soleKeyByLemma(
  index: readonly Pick<CatalogueEntry, 'k'>[],
): Map<string, WordKey | null> {
  const byLemma = new Map<string, WordKey | null>();
  for (const w of index) {
    const lemma = w.k.split('|')[0];
    byLemma.set(lemma, byLemma.has(lemma) ? null : w.k);
  }
  return byLemma;
}

/** Cards whose word the catalogue no longer lists under that key, re-keyed to
 *  the entry it now lists for the same lemma. Only an unambiguous move is made
 *  — exactly one entry for that lemma — and a key naming one of the learner's
 *  own words is left alone. Returns the pairs of (old card, re-keyed card) to
 *  persist. */
export function rekeyOrphans(
  cards: readonly Card[],
  index: readonly Pick<CatalogueEntry, 'k'>[],
  userKeys: ReadonlySet<WordKey> = new Set(),
): Rekey[] {
  const known = new Set(index.map((w) => w.k));
  const byLemma = soleKeyByLemma(index);
  const taken = new Set(cards.map((c) => c.id));
  const moves: Rekey[] = [];
  for (const c of cards) {
    if (!c.channel || known.has(c.key) || userKeys.has(c.key)) continue;
    const target = byLemma.get(c.key.split('|')[0]);
    if (!target) continue;
    const id = cardId(target, c.channel, c.rung);
    if (taken.has(id)) continue;
    moves.push([c, { ...c, key: target, id, updatedAt: Date.now() }]);
  }
  return moves;
}

/** One active card per word per channel: the highest rung. Lower rungs are
 *  retired, kept for their history. The flag is derived locally and never
 *  synced.
 *
 *  Returns the same array contents, with only the cards whose flag changed
 *  replaced, so a caller can tell what to write back by identity.
 */
export function settleRungs(cards: readonly Card[]): Card[] {
  const top = new Map<string, number>();
  for (const c of cards) {
    if (!c.channel) continue;
    const k = `${c.key}|${c.channel}`;
    const i = rungIndex(c.channel, c.rung);
    const best = top.get(k);
    if (best === undefined || i > best) top.set(k, i);
  }
  return cards.map((c) => {
    if (!c.channel) return c;
    const retired = rungIndex(c.channel, c.rung) < (top.get(`${c.key}|${c.channel}`) ?? -1);
    return c.retired === retired ? c : { ...c, retired };
  });
}

/** What an answer set in motion: the cards to create, and whether the card
 *  that was answered is now retired. Nothing here is persisted; the caller
 *  writes. */
export interface LadderStep {
  /** The next rung, made fresh and due now, or null if nothing climbed. */
  promoted: Card | null;
  /** True when the answered card has been overtaken and should retire. */
  retire: boolean;
  /** The first card of the heard ladder, where this answer opened it. */
  heard: Card | null;
}

/** What an answer sets in motion, given the card as it now is: the cards to
 *  create, and whether the answered one retires. This only decides; the caller
 *  persists. */
export function afterAnswer({
  card,
  rating,
  word,
  cards,
  now = new Date(),
}: {
  /** The card as it stands after grading, streak included. */
  card: Card;
  /** What was pressed. */
  rating: Grade;
  /** The word, for the sentence check that gates the "use it" rung and the
   *  similarity score that places the heard ladder's first rung. */
  word: (Pick<StudyWord, 'ex'> & EntryScores) | null;
  /** Every rung this word already has, on either channel. */
  cards: readonly Pick<Card, 'key' | 'channel'>[];
  /** The moment the new cards are dated from. */
  now?: Date;
}): LadderStep {
  const out: LadderStep = { promoted: null, retire: false, heard: null };
  if (!isActive(card)) return out;

  const next = nextRung(card.channel, card.rung, word);
  if (next && (climbs(rating, card.streak ?? 0) || isMature(card))) {
    const up = emptyCard(card.key, card.channel, next, now);
    if (card.lesson) up.lesson = card.lesson;
    out.promoted = up;
    out.retire = true;
  }

  const produced =
    card.channel === 'written' &&
    rungIndex('written', card.rung) >= rungIndex('written', 'say') &&
    rating >= Rating.Good;
  const hasHeard = cards.some((c) => c.key === card.key && c.channel === 'heard');
  if (produced && !hasHeard) {
    out.heard = emptyCard(card.key, 'heard', entryRung('heard', word), now);
  }
  return out;
}
