/** A conjugated form, as it is said rather than as it is written.
 *
 *  A verb form on its own is not what anyone hears. "ais" is nothing, "étais"
 *  is barely a word, and "j'étais" is French: the pronoun carries the elision,
 *  the liaison and half the rhythm, and it is what tells you that "parle",
 *  "parles" and "parlent" are one sound with three spellings. So the table
 *  speaks the line, not the cell.
 *
 *  The pipeline has already done the hard part — its pronouns come elided
 *  ("j'", "qu'il") and its subjunctive rows carry their "que" — so the rule
 *  here is short, and the one case it has to know about is the imperative,
 *  whose pronoun is written in brackets because it is not said at all.
 */
import type { Conjugation, ConjugationGroup, ConjugationRow } from './model.js';

/** The tenses a learner meets first, and the only ones made ahead of time: the
 *  literary ones are read far more often than they are said. */
export const CORE_TENSES: readonly string[] = ['pres', 'imp', 'fut', 'cond', 'subj', 'imper'];

/** One phrase of a word: where its clip is kept, and what is in it. */
export interface Phrase {
  /** The word it belongs to. */
  key: string;
  /** Which phrase of that word — "conj:pres:0". Clips are stored under it. */
  slot: string;
  /** What the voice says. */
  text: string;
}

/** Where a row's clip lives: the tense and the row's place in it. Stable
 *  across a rebuild of the catalogue, since neither moves. */
export const conjSlot = (groupId: string, row: number): string => `conj:${groupId}:${row}`;

/** What the voice says for one line of a table.
 *
 *  "(tu)" is the imperative's way of writing a pronoun that is not spoken —
 *  "sois sage", not "tu sois sage" — so it is dropped. An elided pronoun runs
 *  into its verb with no space: "j'étais", never "j' étais".
 */
export function spokenForm(row: ConjugationRow | null | undefined): string {
  const form = (row?.f ?? '').trim();
  if (!form) return '';
  const pronoun = (row?.p ?? '').trim();
  if (!pronoun || pronoun.startsWith('(')) return form;
  return /['’]$/.test(pronoun) ? `${pronoun}${form}` : `${pronoun} ${form}`;
}

/** Every line of one tense, ready to be said. */
export function phrasesOfGroup(key: string, group: ConjugationGroup): Phrase[] {
  const out: Phrase[] = [];
  group.rows.forEach((row, i) => {
    const text = spokenForm(row);
    if (text) out.push({ key, slot: conjSlot(group.id, i), text });
  });
  return out;
}

/** The tense every learner meets first, and the only one prepared for a verb
 *  merely sitting in the queue: six clips a verb rather than forty. */
export const FIRST_TENSES: readonly string[] = ['pres'];

/** Every line of a verb's table worth saying, or only those of the tenses
 *  named.
 *
 *  Nothing prepares a whole table off its own bat: forty clips is a couple of
 *  minutes of a phone's attention, and nobody hovers over the past historic.
 *  The tenses on screen are made when the table is opened, the rest when they
 *  are hovered — which is what the lazy setting makes the rule for everything.
 */
export function phrasesOf(
  key: string, conj: Conjugation | null | undefined, tenses?: readonly string[],
): Phrase[] {
  const groups = conj?.groups ?? [];
  return groups
    .filter((g) => !tenses || tenses.includes(g.id))
    .flatMap((g) => phrasesOfGroup(key, g));
}
