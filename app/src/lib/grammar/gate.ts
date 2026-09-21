/** Which tenses a verb may be asked in: the ones the learner has opened.
 *
 *  The form channel used to rotate through every tense a verb has by rep
 *  count, so the second time a card came round it asked for the imparfait
 *  and nothing had said what the imparfait is. Now a tense is a grammar bit
 *  (GRAMMAR.md): the learner reads what it teaches on the Grammar screen and
 *  opens it, and until then no card asks it — the présent included, which
 *  is a bit like any other. Nothing here opens a bit; the app only reads
 *  which are open (db.ts `openBits`) and says which it would suggest next.
 *
 *  `needs` and the order are advice, not locks. The learner picks; the
 *  screen says "builds on the présent, which you have not started" and lets
 *  them. What the advice rests on is in GRAMMAR.md: the formation of each
 *  tense (the imparfait's stem is the présent's nous form, the conditionnel
 *  is the futur's stem with the imparfait's endings) and the order learners
 *  are observed to take (Bartning & Schlyter: passé composé before
 *  imparfait, futur simple before conditionnel and subjonctif).
 *
 *  The ids are the rules' ids from the inventory, so a bit opened today is
 *  the same record once the whole registry exists (M2), and this file's
 *  hand-written table is then read off it rather than written here.
 */
import type { BitState } from '../model.js';
import { TENSE_NOTES } from '../tenses.js';

/** The rule each tense of the table is gated by, keyed by the pipeline's
 *  group id (conjugation.py, and TENSE_NOTES). The présent is gated by the
 *  first of its bits — the regular -er verbs — until the registry can say
 *  which présent bit a given verb falls under. */
export const TENSE_RULE: Readonly<Record<string, string>> = {
  pres: 'V.pres-er',
  imp: 'V.imparfait',
  fut: 'V.futur',
  cond: 'V.conditionnel',
  subj: 'V.subj-forms',
  imper: 'V.imperative',
  pc: 'V.pc',
  pqp: 'V.pqp',
  futant: 'V.futur-anterieur',
  condp: 'V.cond-passe',
  subjp: 'V.subj-passe',
  hist: 'V.passe-simple',
};

/** A tense that is read and never asked, so it has no bit: the table shows
 *  it, and no card is ever built on it. */
export const READ_ONLY_TENSES: readonly string[] = ['subjimp'];

/** What each tense is built on, as advice: the tenses whose forms this one
 *  is made from, or whose meaning it is told apart from. */
export const TENSE_NEEDS: Readonly<Record<string, readonly string[]>> = {
  pres: [],
  pc: ['pres'],
  imp: ['pres'],
  fut: ['pres'],
  imper: ['pres'],
  cond: ['fut', 'imp'],
  subj: ['imp'],
  pqp: ['imp', 'pc'],
  futant: ['fut', 'pc'],
  condp: ['cond', 'pc'],
  subjp: ['subj', 'pc'],
  hist: ['pc', 'imp'],
};

/** The order the Grammar screen lists the tenses in, and the order the next
 *  one is suggested in: what the syllabus and the acquisition research
 *  agree on, everyday tenses first, the literary one last. */
export const TENSE_ORDER: readonly string[] = [
  'pres', 'pc', 'imp', 'fut', 'cond', 'imper', 'subj', 'pqp', 'futant', 'condp', 'subjp', 'hist',
];

/** The bits that are open, as a set of rule ids: a closed bit is a
 *  tombstone and does not count. */
export const openRules = (bits: readonly Pick<BitState, 'id' | 'deleted'>[]): Set<string> =>
  new Set(bits.filter((b) => !b.deleted).map((b) => b.id));

/** The tenses a verb may be asked in, in table order: those whose bit is
 *  open. Empty until the learner opens one, and then the form channel deals
 *  nothing (session.ts). */
export function openedTenses(bits: readonly Pick<BitState, 'id' | 'deleted'>[]): string[] {
  const open = openRules(bits);
  return TENSE_ORDER.filter((t) => open.has(TENSE_RULE[t]!));
}

/** The tense to suggest next: the first in order that is not open, or null
 *  when every tense is. A suggestion, which the screen says as one. */
export function suggestedNext(bits: readonly Pick<BitState, 'id' | 'deleted'>[]): string | null {
  const open = openRules(bits);
  return TENSE_ORDER.find((t) => !open.has(TENSE_RULE[t]!)) ?? null;
}

/** One row of the Grammar screen's list of tenses. */
export interface TenseRow {
  tense: string;
  /** The tense's French name, as the table heads it. */
  name: string;
  rule: string;
  open: boolean;
  /** The one the screen suggests starting next. */
  suggested: boolean;
  /** The tenses this one builds on that are not open yet: what the screen
   *  says in a line, not what stops the learner. */
  missing: { tense: string; name: string }[];
}

/** The tenses in order, each with what the screen says about it. Pure over
 *  the bit records, so the screen decides nothing. */
export function tenseRows(bits: readonly Pick<BitState, 'id' | 'deleted'>[]): TenseRow[] {
  const open = openRules(bits);
  const next = suggestedNext(bits);
  const nameOf = (t: string): string => TENSE_NOTES[t]?.name ?? t;
  return TENSE_ORDER.map((tense) => ({
    tense,
    name: nameOf(tense),
    rule: TENSE_RULE[tense]!,
    open: open.has(TENSE_RULE[tense]!),
    suggested: tense === next,
    missing: (TENSE_NEEDS[tense] ?? [])
      .filter((t) => !open.has(TENSE_RULE[t]!))
      .map((t) => ({ tense: t, name: nameOf(t) })),
  }));
}
