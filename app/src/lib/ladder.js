/** How a word climbs.
 *
 *  Three decisions live here, all pure:
 *
 *  * where a word *enters* each channel, from how much it resembles its
 *    English on the page and out loud;
 *  * when it moves *up* — on demonstrated ease: two Good answers in a row on
 *    the rung, or one Easy, and the difficulty is too low for what is left to
 *    learn. Waiting for the card to be mature instead cost weeks per rung
 *    for nothing the evidence asked for; maturity still counts, as the
 *    ceiling, and still defines what is known;
 *  * when the heard channel *opens* — the first time the word has been
 *    produced aloud, since recognising a sound you have never made is a
 *    different question from recognising one you have.
 *
 *  A promotion is a new card, not a longer interval on the old one: the new
 *  rung tests a different memory, with an unknown share carried over, and a
 *  new card's first rating is exactly the measurement of that share. There is
 *  no demotion rule. An Again on the new card is ordinary relearning, and the
 *  leech threshold already exists for the word that keeps failing.
 */
import { LEGACY_RUNG, LOOKS_FREE, RUNGS, SOUNDS_FREE, cardId } from './keys.js';
import { Rating, emptyCard, isMature } from './scheduler.js';

export const rungIndex = (channel, rung) => RUNGS[channel]?.indexOf(rung) ?? -1;

/** The rung above, or null at the top. "Use it" needs a sentence to use it in,
 *  so it is skipped for a word that has none yet. */
export function nextRung(channel, rung, word = null) {
  const next = RUNGS[channel]?.[rungIndex(channel, rung) + 1] ?? null;
  if (next === 'use' && !(word?.ex?.length)) return null;
  return next;
}

/** Where a word starts. A word that reads as English starts by being written:
 *  its meaning was never in question, and the article, the gender and the
 *  accents — the only things left to learn — are tested by nothing but
 *  typing. A word that does not read as English starts by being recognised.
 *  A word that sounds like English skips hearing for meaning and goes
 *  straight to writing it down. A word with no score, such as one you added
 *  yourself, starts at the bottom. */
export function entryRung(channel, word) {
  if (channel === 'written') return (word?.looks ?? 0) >= LOOKS_FREE ? 'write' : 'recognise';
  return (word?.sounds ?? 0) >= SOUNDS_FREE ? 'dictate' : 'hear';
}

/** Good answers in a row before a rung is climbed, and the single answer
 *  that climbs it at once. Ease is measured, not waited for: succeeding
 *  easily is the sign the difficulty is too low, and the next rung is where
 *  the next thing to learn is. */
export const CLIMB_STREAK = 2;
export const CLIMB_AT_ONCE = Rating.Easy;

/** Consecutive answers of Good or better on this card, kept on the card. */
export function streakAfter(card, rating) {
  return rating >= Rating.Good ? (card.streak ?? 0) + 1 : 0;
}

/** Whether an answer of `rating` on a card, now carrying `streak`, climbs. */
export const climbs = (rating, streak) => rating >= CLIMB_AT_ONCE || streak >= CLIMB_STREAK;

/** A card from before the ladder, placed on the rung its direction implies.
 *  Idempotent: a card already on a rung comes back unchanged, and a card of
 *  no known shape is left alone. The speaking direction maps to nothing — it
 *  was graded by a recogniser that dropped the article — and its history
 *  stays in the log. */
export function legacyToChannel(card) {
  if (!card) return null;
  if (card.channel && card.rung) return card;
  if (!card.direction) return card;
  const to = LEGACY_RUNG[card.direction];
  if (!to) return null;
  const [channel, rung] = to;
  const { direction, ...rest } = card;
  return { ...rest, id: cardId(card.key, channel, rung), channel, rung };
}

export const isActive = (card) => !!card?.channel && !card.retired;

/** Cards whose word the catalogue no longer lists under that key, re-keyed to
 *  the entry it now lists for the same lemma.
 *
 *  A rebuild can decide that "vidéo" is the noun after all, and the card was
 *  keyed "vidéo|adj". The scheduling state is about the spelling the learner
 *  met, not about a part-of-speech label, so it moves with the word. Only an
 *  unambiguous move is made — exactly one entry for that lemma — and a key
 *  that names one of your own words is left alone. Returns the pairs of
 *  (old card, re-keyed card) to persist.
 */
export function rekeyOrphans(cards, index, userKeys = new Set()) {
  const known = new Set(index.map((w) => w.k));
  const byLemma = new Map();
  for (const w of index) {
    const lemma = w.k.split('|')[0];
    byLemma.set(lemma, byLemma.has(lemma) ? null : w.k);   /* null: ambiguous */
  }
  const ids = new Set(cards.map((c) => c.id));
  const moves = [];
  for (const c of cards) {
    if (!c.channel || known.has(c.key) || userKeys.has(c.key)) continue;
    const target = byLemma.get(c.key.split('|')[0]);
    if (!target) continue;
    const id = cardId(target, c.channel, c.rung);
    if (ids.has(id)) continue;             /* the word already has that rung */
    moves.push([c, { ...c, key: target, id, updatedAt: Date.now() }]);
  }
  return moves;
}

/** One active card per word per channel: the highest rung. Lower rungs are
 *  retired, kept for their history. Derived, not synced — every device reaches
 *  the same answer from the same cards, so the flag never needs to travel. */
export function settleRungs(cards) {
  const top = new Map();
  for (const c of cards) {
    if (!c.channel) continue;
    const k = `${c.key}|${c.channel}`;
    const i = rungIndex(c.channel, c.rung);
    if (!top.has(k) || i > top.get(k)) top.set(k, i);
  }
  return cards.map((c) => {
    if (!c.channel) return c;
    const retired = rungIndex(c.channel, c.rung) < top.get(`${c.key}|${c.channel}`);
    return !!c.retired === retired ? c : { ...c, retired };
  });
}

/** What an answer sets in motion, given the card as it now is.
 *
 *  Returns the cards to create and whether the answered one retires. The
 *  caller persists; this only decides.
 */
export function afterAnswer({ card, rating, word, cards, now = new Date() }) {
  const out = { promoted: null, retire: false, heard: null };
  if (!isActive(card)) return out;

  const next = nextRung(card.channel, card.rung, word);
  if (next && (climbs(rating, card.streak ?? 0) || isMature(card))) {
    const up = emptyCard(card.key, card.channel, next, now);
    if (card.lesson) up.lesson = card.lesson;
    out.promoted = up;
    out.retire = true;
  }

  const produced = card.channel === 'written'
    && rungIndex('written', card.rung) >= rungIndex('written', 'say')
    && rating >= Rating.Good;
  const hasHeard = cards.some((c) => c.key === card.key && c.channel === 'heard');
  if (produced && !hasHeard) {
    out.heard = emptyCard(card.key, 'heard', entryRung('heard', word), now);
  }
  return out;
}
