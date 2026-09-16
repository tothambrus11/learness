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

/** One line of a tense as a reading says it: which row of the table it is,
 *  so the screen can mark the line being said, and the phrase itself. */
export interface SpokenLine {
  /** The row's place in the group, as the table numbers it — the same
   *  number the slot carries, kept apart so a screen never parses a slot. */
  row: number;
  phrase: Phrase;
}

/** A whole tense, one person at a time, in the order the table shows: je,
 *  tu, il, nous, vous, ils — which is the order the pipeline writes the rows
 *  in, and the order they read down the first column and then the second.
 *  A row with nothing in it is skipped, not paused on; a variant ("je paye"
 *  beside "je paie") is not read, only the form the table stands on; and
 *  the imperative is read without its bracketed pronoun, as spokenForm says.
 *  Every line's slot is the one the hover uses, so a line read here is a
 *  clip the hover finds ready. */
export function tenseInOrder(key: string, group: ConjugationGroup): SpokenLine[] {
  const out: SpokenLine[] = [];
  group.rows.forEach((row, i) => {
    const text = spokenForm(row);
    if (text) out.push({ row: i, phrase: { key, slot: conjSlot(group.id, i), text } });
  });
  return out;
}

/** Every line of one tense, ready to be said — the same lines, in the same
 *  order, as a reading of it. */
export function phrasesOfGroup(key: string, group: ConjugationGroup): Phrase[] {
  return tenseInOrder(key, group).map((line) => line.phrase);
}

/** A reading in progress. `done` resolves when the last line has been said,
 *  or sooner when the reading was stopped or a line could not be heard:
 *  true only if every line sounded. */
export interface Reading {
  done: Promise<boolean>;
  /** End it now. What is being said is the caller's to cut short (the
   *  player's `stop`); what was still to come is never asked for. */
  stop: () => void;
}

/** Say these lines one after another: each starts when the last has finished,
 *  never before, because six voices at once is what pointing along a column
 *  used to do and the whole point of a reading is to hear them in turn.
 *
 *  `say` is one line, resolving true when it was heard; it is a parameter so
 *  the order can be tested without a speaker, and so this file stays free of
 *  the player it is said through. `onLine` hears each line as it starts and
 *  null when the reading is over, however it ended. A line nothing could
 *  sound — no clip, no voice — ends the reading: a device that cannot say
 *  the first person cannot say the sixth, and a button that sits through six
 *  silent turns is a button that did nothing.
 */
export function readInTurn(
  lines: readonly SpokenLine[],
  say: (line: SpokenLine) => Promise<boolean>,
  onLine: (line: SpokenLine | null) => void = () => {},
): Reading {
  let stopped = false;
  const done = (async (): Promise<boolean> => {
    try {
      for (const line of lines) {
        if (stopped) return false;
        onLine(line);
        let heard = false;
        try {
          heard = await say(line);
        } catch {
          heard = false;               /* a line that throws is one that did not sound */
        }
        if (stopped || !heard) return false;
      }
      return true;
    } finally {
      onLine(null);
    }
  })();
  return {
    done,
    stop(): void { stopped = true; },
  };
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
