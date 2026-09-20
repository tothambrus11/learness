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
import { pickableTenses } from './examples.js';
import { LEGACY_RUNG, LOOKS_FREE, RUNGS, SOUNDS_FREE, cardId } from './keys.js';
import type { Channel, Direction, Rung, WordKey } from './keys.js';
import type { IndexEntry, LadderCard, StoredCard, StudyWord } from './model.js';
import { Rating, State, emptyCard, isDue, isMature } from './scheduler.js';
import { CORE_TENSES } from './conjspeech.js';
import type { Grade } from './scheduler.js';
import { nowMs } from './units.js';

const rungIndex = (channel: Channel, rung: Rung): number =>
  RUNGS[channel]?.indexOf(rung) ?? -1;

/** As much of a word as the ladder ever reads: the shape shared by the index
 *  row, which is what a fresh card is dealt from, and the full record. */
export type WordShape = Partial<Pick<StudyWord, 'looks' | 'sounds' | 'kind' | 'ex' | 'conj'>>;

/** A function word: one the ranking left out and the inventory put back. */
export const isFunctionWord = (
  word: Pick<StudyWord, 'kind'> | Pick<IndexEntry, 'kind'> | null | undefined,
): boolean => word?.kind === 'function';

/** The rung above, or null at the top. A rung that needs a sentence — "use
 *  it", and everything a function word does — is skipped for a word that has
 *  none yet; the voice rung needs a table with a form in it. */
export function nextRung(
  channel: Channel, rung: Rung, word: WordShape | null = null, tenses?: readonly string[],
): Rung | null {
  const next = RUNGS[channel]?.[rungIndex(channel, rung) + 1] ?? null;
  if ((next === 'use' || next === 'choose' || next === 'fill') && !(word?.ex?.length)) return null;
  if (next === 'voice' && !hasCoreForms(word, tenses)) return null;
  return next;
}

/** A verb whose table has a form to say in one of the tenses a learner meets
 *  first — among the tenses given, where a set is: the learner's open ones,
 *  in a sitting. Without a set, any. The literary tenses are read, never
 *  said, so they do not count either way. */
export const hasCoreForms = (
  word: WordShape | null | undefined, tenses?: readonly string[],
): boolean =>
  !!word?.conj?.groups.some((g) => CORE_TENSES.includes(g.id) && (!tenses || tenses.includes(g.id))
    && g.rows.some((r) => !!r.f));

/** Whether a card can be asked with the tenses the learner has opened. Every
 *  card but a form card can; a which-time card needs two of its times open
 *  to tell apart, a voice card a form in an open tense to say. A form card
 *  that cannot is not dealt (session.ts): the learner has not opened what
 *  it would ask, which is the whole point of the gate (GRAMMAR.md). */
export function askable(
  card: Pick<StoredCard, 'channel' | 'rung'>, word: WordShape | null | undefined,
  tenses?: readonly string[],
): boolean {
  if (card.channel !== 'form') return true;
  if (card.rung === 'tense') return pickableTenses(word?.conj, tenses).length >= 2;
  return hasCoreForms(word, tenses);
}

/** The form cards to move from the which-time rung to the voice rung: those
 *  whose two times to tell apart are not both open while a form in an open
 *  tense is there to say. A learner who opened the présent first would
 *  otherwise have no form card at all until the passé composé and the
 *  imparfait were both open — and the which-time card, which existed before
 *  the gate, was put on every verb that could take it whether or not those
 *  times had been taught. The move is one way, as the ladder is, and keeps
 *  the card's state. Returns (old card, moved card) pairs to persist. */
export function regateForms(
  cards: readonly StoredCard[], wordOf: (key: WordKey) => WordShape | null | undefined,
  tenses: readonly string[],
): [StoredCard, StoredCard][] {
  const ids = new Set(cards.map((c) => c.id));
  const moves: [StoredCard, StoredCard][] = [];
  for (const c of cards) {
    if (c.channel !== 'form' || c.rung !== 'tense' || c.retired) continue;
    const word = wordOf(c.key);
    if (askable(c, word, tenses) || !hasCoreForms(word, tenses)) continue;
    const id = cardId(c.key, 'form', 'voice');
    if (ids.has(id)) continue;
    moves.push([c, { ...c, id, rung: 'voice', updatedAt: nowMs() }]);
  }
  return moves;
}

/** The channel a word starts on. A function word has no English to read it
 *  from — its meaning is where it stands — so it never gets a written card at
 *  all; it starts, and stays, on the sense channel. */
export const entryChannel = (word: Pick<StudyWord, 'kind'> | Pick<IndexEntry, 'kind'> | null): Channel =>
  isFunctionWord(word) ? 'sense' : 'written';

/** Where a word starts on a channel.
 *
 *  Written: a word that reads as English starts by being written — its
 *  meaning was never in question, and the article, the gender and the accents
 *  are tested by nothing but typing; one that does not starts by being
 *  recognised. Heard: a word that sounds like English skips hearing for
 *  meaning and goes straight to writing it down. Sense: always at the meeting,
 *  since a function word has no score and a score would mean nothing — a
 *  function word with no `looks` fell through to "recognise" once, which for
 *  *sur* is the card "sur → on / about / over", the very card DESIGN.md
 *  excluded these words to avoid. Form: at the which-time card where the verb
 *  has two tenses to tell apart, else straight to saying its forms. */
export function entryRung(
  channel: Channel, word: WordShape | null, tenses?: readonly string[],
): Rung {
  if (channel === 'written') return (word?.looks ?? 0) >= LOOKS_FREE ? 'write' : 'recognise';
  if (channel === 'heard') return (word?.sounds ?? 0) >= SOUNDS_FREE ? 'dictate' : 'hear';
  if (channel === 'sense') return 'meet';
  return pickableTenses(word?.conj, tenses).length >= 2 ? 'tense' : 'voice';
}

/** Good answers in a row before a rung is climbed, and the single answer
 *  that climbs it at once. Ease is measured, not waited for: succeeding
 *  easily is the sign the difficulty is too low, and the next rung is where
 *  the next thing to learn is. */
export const CLIMB_STREAK = 2;
export const CLIMB_AT_ONCE: Grade = Rating.Easy;

/** Consecutive answers of Good or better on this card, kept on the card. */
export function streakAfter(card: Pick<StoredCard, 'streak'>, rating: Grade): number {
  return rating >= Rating.Good ? (card.streak ?? 0) + 1 : 0;
}

/** Whether an answer of `rating` on a card, now carrying `streak`, climbs. */
export const climbs = (rating: Grade, streak: number): boolean =>
  rating >= CLIMB_AT_ONCE || streak >= CLIMB_STREAK;

/** A card from before the ladder, placed on the rung its direction implies.
 *  Idempotent: a card already on a rung comes back unchanged, and a card of
 *  no known shape is left alone. The speaking direction maps to nothing — it
 *  was graded by a recogniser that dropped the article — and its history
 *  stays in the log. */
export function legacyToChannel(card: StoredCard | null | undefined): StoredCard | null {
  if (!card) return null;
  if (card.channel && card.rung) return card;
  if (!card.direction) return card;
  const to = LEGACY_RUNG[card.direction as Direction];
  if (!to) return null;
  const [channel, rung] = to;
  const { direction: _direction, ...rest } = card;
  return { ...rest, id: cardId(card.key, channel, rung), channel, rung };
}

/** A card with a place on the ladder that has not been retired: the only kind
 *  that is ever scheduled. */
export const isActive = (card: StoredCard | null | undefined): card is LadderCard =>
  !!card?.channel && !!card.rung && !card.retired;

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
export function rekeyOrphans(
  cards: readonly StoredCard[],
  index: readonly IndexEntry[],
  userKeys: ReadonlySet<WordKey> = new Set(),
): [StoredCard, StoredCard][] {
  const known = new Set(index.map((w) => w.k));
  const byLemma = new Map<string, WordKey | null>();
  for (const w of index) {
    const lemma = w.k.split('|')[0] ?? '';
    byLemma.set(lemma, byLemma.has(lemma) ? null : w.k);   /* null: ambiguous */
  }
  const ids = new Set(cards.map((c) => c.id));
  const moves: [StoredCard, StoredCard][] = [];
  for (const c of cards) {
    if (!c.channel || !c.rung || known.has(c.key) || userKeys.has(c.key)) continue;
    const target = byLemma.get(c.key.split('|')[0] ?? '');
    if (!target) continue;
    const id = cardId(target, c.channel, c.rung);
    if (ids.has(id)) continue;             /* the word already has that rung */
    moves.push([c, { ...c, key: target, id, updatedAt: nowMs() }]);
  }
  return moves;
}

/** One active card per word per channel: the highest rung. Lower rungs are
 *  retired, kept for their history. Derived, not synced — every device reaches
 *  the same answer from the same cards, so the flag never needs to travel. */
export function settleRungs<T extends StoredCard>(cards: readonly T[]): T[] {
  const top = new Map<string, number>();
  for (const c of cards) {
    if (!c.channel || !c.rung) continue;
    const k = `${c.key}|${c.channel}`;
    const i = rungIndex(c.channel, c.rung);
    if (i > (top.get(k) ?? -Infinity)) top.set(k, i);
  }
  return cards.map((c) => {
    if (!c.channel || !c.rung) return c;
    const retired = rungIndex(c.channel, c.rung) < (top.get(`${c.key}|${c.channel}`) ?? -1);
    return !!c.retired === retired ? c : { ...c, retired };
  });
}

/** What an answer sets in motion: the card to create where the word climbs,
 *  whether the answered card retires under it, the heard-channel card to open
 *  where the word has just been produced aloud for the first time, and the
 *  form-channel card to open where a verb has just become known. */
export interface LadderStep {
  promoted: LadderCard | null;
  retire: boolean;
  heard: LadderCard | null;
  form: LadderCard | null;
}

/** What an answer sets in motion, given the card as it now is.
 *
 *  Returns the cards to create and whether the answered one retires. The
 *  caller persists; this only decides.
 */
export function afterAnswer({ card, rating, word, cards, now = new Date(), tenses }: {
  card: StoredCard;
  rating: Grade;
  word: WordShape | null;
  cards: readonly StoredCard[];
  now?: Date;
  /** The tenses the learner has opened: where a verb's forms enter, and
   *  whether they open at all. Without a set, every tense: the tests, and
   *  nothing else. */
  tenses?: readonly string[];
}): LadderStep {
  const out: LadderStep = { promoted: null, retire: false, heard: null, form: null };
  if (!isActive(card)) return out;

  const next = nextRung(card.channel, card.rung, word, tenses);
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
    /* A word of yours is yours on every channel: the flag is what keeps its
       cards from being cut for room, and it did not reach the ear once. */
    if (card.lesson) out.heard.lesson = card.lesson;
  }

  /* A verb's forms are the next thing to learn once the verb itself is
     known — and not before, since "il partait" is not a question about a
     word you cannot yet produce. Known is what the written channel being
     mature means everywhere else, so it means it here. And only in a tense
     the learner has opened: with none open the card is not made, and is
     made the next time the verb is answered once one is. */
  const entry = entryRung('form', word, tenses);
  const known = card.channel === 'written' && isMature(card)
    && askable({ channel: 'form', rung: entry }, word, tenses);
  const hasForm = cards.some((c) => c.key === card.key && c.channel === 'form');
  if (known && !hasForm) {
    out.form = emptyCard(card.key, 'form', entry, now);
    if (card.lesson) out.form.lesson = card.lesson;
  }
  return out;
}

/** Where a word stands, in a word: what the words list shows beside each of
 *  yours, and what the connector tells Claude about a word it is asked to add.
 *
 *  Read off the word's written card, or its sense card for a function word,
 *  which has no written one. "not started" is a word with no card on either;
 *  "up next" is one whose card exists but has never been answered. Coarse on
 *  purpose: it says nothing about any single review. */
export type WordStatus = 'not started' | 'up next' | 'learning' | 'due' | 'known';

export function statusOf(
  key: WordKey, cards: readonly StoredCard[], now: Date = new Date(),
): WordStatus {
  const c = cards.find((x) => x.key === key && x.channel === 'written' && isActive(x))
    ?? cards.find((x) => x.key === key && x.channel === 'sense' && isActive(x));
  if (!c) return 'not started';
  if (c.state === State.New) return 'up next';
  if (isMature(c)) return 'known';
  return isDue(c, now) ? 'due' : 'learning';
}
