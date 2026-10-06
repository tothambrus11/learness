/** The words the learner has studied: answered at least once, on any card.
 *
 *  Not "known" — a word met once and missed is studied — because what the
 *  sheets want is words that are not strangers: an exercise on the
 *  possessives reads better on *ma voiture* if *voiture* is a word the
 *  learner has already seen on a card (#110). A word set aside or removed is
 *  not offered, whatever its history.
 */
import { allCards } from './db.js';
import type { WordKey } from './keys.js';
import type { StoredCard, StudyWord } from './model.js';
import { activeUserWords, anyWord, skippedKeys } from './words.js';

/** The keys of every word with a card answered at least once, less the
 *  ones in `leave` — the skipped and the removed — in key order, so the
 *  same cards give the same list. Pure. */
export function studiedKeys(cards: readonly StoredCard[], leave: ReadonlySet<WordKey>): WordKey[] {
  const keys = new Set<WordKey>();
  for (const card of cards) if (card.reps > 0 && !leave.has(card.key)) keys.add(card.key);
  return [...keys].sort();
}

/** The studied words of one part of speech, as a card would show them: the
 *  catalogue's record with the learner's corrections, or their own record.
 *  A key nothing resolves any more — a catalogue rebuilt without it — is
 *  left out rather than failing the list. Reads the database and, for the
 *  catalogue's words, the level files they live in. */
export async function studiedWords(pos: string): Promise<StudyWord[]> {
  const [cards, mine] = await Promise.all([allCards(), activeUserWords()]);
  const own = new Map(mine.map((w) => [w.k, w]));
  /* A word removed has only a tombstone, which `activeUserWords` leaves
     out; its cards may still be in the store, so a card is studied only if
     its word is still somewhere. Skipped is the learner saying no. */
  const keys = studiedKeys(cards, skippedKeys(mine)).filter((key) => key.endsWith(`|${pos}`));
  const out: StudyWord[] = [];
  for (const key of keys) {
    const word = await anyWord(key, own);
    if (word) out.push(word);
  }
  return out;
}
