/** Finding a word from what someone typed into a box.
 *
 *  Two lists are searched with the same rules — the catalogue, which is loaded
 *  whole, and the dictionary, which arrives a letter at a time — so the rules
 *  live here rather than in either. What they have to get right is that a
 *  learner types what they heard: "chaussette" for "la chaussette", "ecole"
 *  for "école", "Le Jour" after a full stop. None of that is a different word.
 *
 *  The article comes off with `splitArticle`, which is the same reader the
 *  cards are painted from: one list of what a French article looks like, not
 *  two that would drift.
 */
import { splitArticle } from './gender.js';

/** A word reduced to what a search should compare: lower case, no accents, no
 *  punctuation. "l'Été" and "lete" fold to the same thing. */
export const fold = (s: string | null | undefined): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z' ]+/g, ' ')
    .trim();

/** The word without the article the catalogue shows it with, still spelt as it
 *  was written: typing "jour" must find "le jour", and typing "le jour" must
 *  not fail to. */
export const bare = (text: string | null | undefined): string =>
  splitArticle(text).rest || (text ?? '').trim();

/** What a search means, folded once so a list can be scored against it without
 *  folding the query per row. */
export interface Query {
  /** The whole thing, folded: what an English gloss is compared against. */
  all: string;
  /** Without its article, folded: what a French headword is compared against. */
  word: string;
}

export const queryOf = (text: string): Query => ({ all: fold(text), word: fold(bare(text)) });

/** How well one entry answers a query; 0 means not at all.
 *
 *  An exact French word beats a prefix, a prefix beats a substring, and the
 *  French beats the English — someone typing French is naming a word, while
 *  someone typing English is describing one, and the first is the surer of the
 *  two. A longer word matching the same prefix scores lower, so "jour" comes
 *  before "journalisme".
 */
export function score(q: Query, fr: string, en: readonly string[] = []): number {
  if (!q.word) return 0;
  const word = fold(bare(fr));
  if (word === q.word) return 100;
  if (word.startsWith(q.word)) return 80 - (word.length - q.word.length);
  if (word.includes(q.word)) return 50;
  if (en.some((e) => fold(e) === q.all)) return 40;
  if (en.some((e) => fold(e).includes(q.all))) return 20;
  return 0;
}

/** Where anything that does not start with a plain letter is filed in the
 *  dictionary. The pipeline files it the same way; `tests/test_webexport.py`
 *  says so on that side and `dictionary.test.ts` on this one. */
export const OTHER = 'other';

/** Which dictionary file a query would be answered from: the first letter of
 *  the word itself, with its accent taken off, so "Étable" and "etable" ask
 *  for the same one and "la chaussette" asks for c.
 *
 *  Exactly what `webexport.dict_shard` does on the other side — decompose,
 *  take the first character, keep it if it is a plain letter — because the two
 *  names have to be the same string or the fetch is a 404. Here rather than in
 *  dictionary.ts because the server asks the same question of the same files. */
export function shardOf(query: string): string {
  const first = bare(query).toLowerCase().normalize('NFD').slice(0, 1);
  return /^[a-z]$/.test(first) ? first : OTHER;
}
