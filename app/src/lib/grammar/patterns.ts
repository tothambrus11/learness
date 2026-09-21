/** The pattern generators: exercises that are a sentence or a table looked
 *  at rather than filled — which time a sentence is in, the order of a
 *  negation's pieces, which forms sound alike, what an ending predicts
 *  (GRAMMAR.md: the *which*, *order* and *mark* faces).
 *
 *  Each is made from what the learner already has — a verb's own sentences
 *  and table from the catalogue — or from a closed list the rule itself
 *  is, so the key is never in doubt. Pure; the dealer picks among them.
 */
import type { Example, StudyWord } from '../model.js';
import { orderedBy } from '../shuffle.js';
import { TIME_MEANING } from '../tenses.js';
import { joinPieces, markPieces } from './instance.js';
import type { Instance } from './instance.js';
import { digits, words } from './numbers.js';
import type { Dialect } from './numbers.js';
import type { RuleId } from './rules.js';
import { tableFor, tableRuleOf } from './table.js';

/** The analyser's version, on every attempt these label. */
export const PATTERN_GENV = 1;

export const PATTERN_RULE_IDS: readonly RuleId[] =
  ['V.pc-vs-imp', 'G.pas-infinitive', 'G.pas-compound', 'P.verb-endings', 'D.gender-endings', 'N.french-tens'];

/* -------------------------------------------------------- which time -- */

/** A sentence of the verb in the passé composé or the imparfait, and the
 *  two times to choose between, said as what happened rather than as
 *  names. No English on the card: "she spoke" would say it. */
export function whichTimeFor(word: Pick<StudyWord, 'k' | 'conj'>, ex: Example, tense: 'pc' | 'imp'): Instance | null {
  if (ex.id === undefined || !ex.f) return null;
  const options = [TIME_MEANING.pc!, TIME_MEANING.imp!];
  return {
    id: `sentence:${word.k}:${ex.id}:V.pc-vs-imp`, gen: 'whichtime', face: 'which',
    spec: { key: word.k, sid: ex.id, tense }, genv: PATTERN_GENV, rule: 'V.pc-vs-imp',
    title: 'When is this?', hint: '',
    cells: [{ prompt: '', expected: TIME_MEANING[tense]!, options, obs: [{ of: 'V.pc-vs-imp', on: 'form' }] }],
    sentence: ex,
  };
}

export const whichTimesFor = (word: Pick<StudyWord, 'k' | 'conj'>): Instance[] =>
  (['pc', 'imp'] as const).flatMap((tense) =>
    (word.conj?.examples?.[tense] ?? []).map((ex) => whichTimeFor(word, ex, tense)).filter((i): i is Instance => i !== null));

/* -------------------------------------------------------------- order -- */

const MODALS = [['veux', "I don't want to"], ['peux', "I can't"], ['dois', "I don't have to"]] as const;

/** A seed from a word's key: the same word, the same order, on every device. */
function seedOf(key: string): number {
  let n = 0;
  for (let i = 0; i < key.length; i += 1) n += key.charCodeAt(i);
  return n;
}

/** The pieces of a sentence shuffled by a seed, never left in order. */
function shuffled(pieces: readonly string[], seed: number): string[] {
  let order = orderedBy(pieces.length, seed);
  if (order.every((i, at) => i === at)) order = orderedBy(pieces.length, seed + 1);
  return order.map((i) => pieces[i]!);
}

/** *je ne veux pas partir*: both halves around the modal, the infinitive
 *  after. The modal is picked by the verb, so a verb always asks the same
 *  one and the exercise is the same on every device. */
export function negInfinitiveFor(word: Pick<StudyWord, 'k' | 'en' | 'conj'>): Instance | null {
  const lemma = word.conj?.lemma;
  if (!lemma) return null;
  const seed = seedOf(word.k);
  const [modal, en] = MODALS[seed % MODALS.length]!;
  const right = ['je', 'ne', modal, 'pas', lemma];
  return {
    id: `order:${word.k}:G.pas-infinitive`, gen: 'order', face: 'order',
    spec: { key: word.k, modal }, genv: PATTERN_GENV, rule: 'G.pas-infinitive',
    title: `${en} ${(word.en[0] ?? lemma).replace(/^to /, '')}`, hint: 'tap the pieces in order',
    cells: [{ prompt: '', expected: joinPieces(right), pieces: shuffled(right, seed),
      obs: [{ of: 'G.pas-infinitive', on: 'form' }, { of: 'G.pas', on: 'form' }] }],
  };
}

/** *je n'ai pas parlé*: the negation around the auxiliary, from the verb's
 *  own passé composé; *je ne suis pas parti* for an *être* verb. */
export function negCompoundFor(word: Pick<StudyWord, 'k' | 'en' | 'conj'>): Instance | null {
  const pc = word.conj?.compound.find((c) => c.id === 'pc');
  if (!pc?.participle) return null;
  const avoir = pc.aux === 'avoir';
  const right = avoir ? ['je', "n'", 'ai', 'pas', pc.participle] : ['je', 'ne', 'suis', 'pas', pc.participle];
  const seed = seedOf(word.k);
  return {
    id: `order:${word.k}:G.pas-compound`, gen: 'order', face: 'order',
    spec: { key: word.k }, genv: PATTERN_GENV, rule: 'G.pas-compound',
    title: `I did not ${(word.en[0] ?? '').replace(/^to /, '')}`, hint: 'tap the pieces in order',
    cells: [{ prompt: '', expected: joinPieces(right), pieces: shuffled(right, seed),
      obs: [{ of: 'G.pas-compound', on: 'form' }, { of: 'G.pas', on: 'form' }] }],
  };
}

/* --------------------------------------------------------------- mark -- */

/** The six présent forms of an *-er* verb, and which of them sound like
 *  the *je* form: *-e, -es, -ent* are all silent, so four of the six are
 *  one sound and only *nous* and *vous* are heard apart. */
export function soundAlikeFor(word: Pick<StudyWord, 'k' | 'en' | 'conj'>): Instance | null {
  const table = tableFor(word, tableRuleOf('V.pres-er')!);
  if (!table) return null;
  const pieces = table.cells.map((c) => `${c.prompt} ${c.expected}`);
  const alike = table.cells.filter((c) => /^(e|es|ent)$/.test(c.ending ?? '')).map((c) => `${c.prompt} ${c.expected}`);
  return {
    id: `mark:${word.k}:P.verb-endings`, gen: 'soundalike', face: 'mark',
    spec: { key: word.k }, genv: PATTERN_GENV, rule: 'P.verb-endings',
    title: `Which sound like ${pieces[0]}?`, hint: 'tap every form that sounds the same',
    cells: [{ prompt: '', expected: markPieces(pieces, alike), pieces, multi: true,
      obs: [{ of: 'P.verb-endings', on: 'form' }] }],
  };
}

/* ------------------------------------------------------------ endings -- */

/** The endings that predict a gender, with two words each that carry it. */
export const GENDER_ENDINGS: readonly { ending: string; gender: 'f' | 'm'; as: string }[] = [
  { ending: '-tion', gender: 'f', as: 'la nation, la station' },
  { ending: '-té', gender: 'f', as: 'la liberté, la santé' },
  { ending: '-ette', gender: 'f', as: 'la fourchette, la baguette' },
  { ending: '-ance', gender: 'f', as: 'la chance, la France' },
  { ending: '-ure', gender: 'f', as: 'la voiture, la nature' },
  { ending: '-ie', gender: 'f', as: 'la vie, la pharmacie' },
  { ending: '-age', gender: 'm', as: 'le fromage, le village (but la page, la plage)' },
  { ending: '-ment', gender: 'm', as: 'le moment, le vêtement' },
  { ending: '-eau', gender: 'm', as: 'le bateau, le bureau (but l\'eau, la peau)' },
  { ending: '-isme', gender: 'm', as: 'le tourisme, le réalisme' },
  { ending: '-oir', gender: 'm', as: 'le soir, le miroir' },
];

/** One ending: masculine or feminine? */
export function endingFor(e: (typeof GENDER_ENDINGS)[number]): Instance {
  return {
    id: `ending:${e.ending.slice(1)}`, gen: 'ending', face: 'which', spec: { ending: e.ending }, genv: PATTERN_GENV,
    rule: 'D.gender-endings', title: e.ending, hint: `as in ${e.as}`,
    cells: [{ prompt: 'words in it are', expected: e.gender === 'f' ? 'feminine' : 'masculine',
      options: ['masculine', 'feminine'], obs: [{ of: 'D.gender-endings', on: 'form' }] }],
  };
}
export const endingsFor = (): Instance[] => GENDER_ENDINGS.map(endingFor);

/* --------------------------------------------------------- french tens -- */

const FRENCH_TENS_POOL: readonly number[] = [70, 71, 72, 75, 79, 80, 81, 85, 90, 91, 95, 99];

/** A French compound read, and the number it is among three: what the
 *  Swiss learner meets on every timetable and never writes. */
export function frenchTensWhichFor(n: number): Instance {
  const others = FRENCH_TENS_POOL.filter((m) => m !== n);
  const order = orderedBy(others.length, n);
  const options = [digits(n), ...order.slice(0, 2).map((i) => digits(others[i]!))];
  const arranged = orderedBy(options.length, n + 7).map((i) => options[i]!);
  return {
    id: `french:${n}`, gen: 'frenchtens', face: 'which', spec: { n }, genv: PATTERN_GENV, rule: 'N.french-tens',
    title: words(n, 'fr'), hint: 'which number is that?',
    cells: [{ prompt: '', expected: digits(n), options: arranged, obs: [{ of: 'N.french-tens', on: 'form' }] }],
  };
}
export const frenchTensWhich = (): Instance[] => FRENCH_TENS_POOL.map(frenchTensWhichFor);

/** Everything a word offers of these. */
export const patternsFor = (word: Pick<StudyWord, 'k' | 'en' | 'conj'>): Instance[] =>
  [...whichTimesFor(word), negInfinitiveFor(word), negCompoundFor(word), soundAlikeFor(word)]
    .filter((i): i is Instance => i !== null);

/** The exercises of one pattern rule on the learner's verbs, or from the
 *  rule's own list. The French compounds are read here whatever the
 *  learner writes; a learner who writes them drills that too (numbers.ts). */
export function patternCandidates(rule: RuleId, verbs: readonly Pick<StudyWord, 'k' | 'en' | 'conj'>[], _dialect: Dialect): Instance[] {
  switch (rule) {
    case 'V.pc-vs-imp': return verbs.flatMap((v) => whichTimesFor(v));
    case 'G.pas-infinitive': return verbs.map(negInfinitiveFor).filter((i): i is Instance => i !== null);
    case 'G.pas-compound': return verbs.map(negCompoundFor).filter((i): i is Instance => i !== null);
    case 'P.verb-endings': return verbs.map(soundAlikeFor).filter((i): i is Instance => i !== null);
    case 'D.gender-endings': return endingsFor();
    case 'N.french-tens': return frenchTensWhich();
    default: return [];
  }
}
