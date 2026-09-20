/** The negation generator: a sentence of the learner's own verb, in the
 *  présent, to make negative — *ne … pas* around the conjugated verb, *n'*
 *  before a vowel (GRAMMAR.md, G.pas).
 *
 *  The answer key is written by the same rule the learner is asked to
 *  apply, over the corpus sentence the verb's card already shows, so the
 *  exercise is on words they know and the key cannot disagree with the
 *  lesson. A sentence the rule alone cannot handle is not dealt: one that
 *  is negative already, one where an object pronoun stands before the verb
 *  (*je le vois*, whose *ne* goes before the pronoun), an inverted question
 *  (*parle-t-il*), and one where *un / une / du / des* follows the verb,
 *  which the negation turns into *de* — a rule of its own (D.de-negative).
 */
import { splitOnForm } from '../examples.js';
import type { Example, StudyWord } from '../model.js';
import type { Cell, Instance, Obs } from './instance.js';
import type { RuleId } from './rules.js';

/** The analyser's version, on every attempt it labels. */
export const NEGATION_GENV = 1;

/** The sentences a verb offers: its présent examples with a corpus id, the
 *  id being what the exercise is known by across a catalogue rebuild. */
const OBJECT_PRONOUNS = new Set(['le', 'la', 'les', "l'", 'me', 'te', 'se', "m'", "t'", "s'", 'lui',
  'leur', 'y', 'en', 'nous', 'vous']);
const SUBJECT_PRONOUNS = new Set(['je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ce', "c'"]);
/** An article after the verb that a negation turns into *de*, and the
 *  word after it, for *d'* before a vowel. */
const ARTICLE_TO_DE = /^\s+(?:(une|un|des|du|de la)\s+|(de l['’]))(\S+)/i;

const startsWithVowel = (form: string): boolean => /^[aeiouyàâäéèêëïîôöùûüœh]/i.test(form);

/** What the negation is made with: *pas*, or *jamais / plus* in its place
 *  (G.others), and whether *un / une / du / des* after the verb becomes
 *  *de* (D.de-negative) — the rule alone leaves such a sentence out. */
export interface NegateOptions {
  word?: 'pas' | 'jamais' | 'plus';
  /** Turn an article after the verb into *de*; without it the sentence is
   *  no instance of the plain rule. */
  deAfter?: boolean;
}

/** The sentence made negative, or null where the rule alone does not do
 *  it. `elided` says whether *ne* became *n'*; `de` whether an article
 *  became *de*, for the labels. */
export function negate(
  ex: Pick<Example, 'fr' | 'f'>, { word = 'pas', deAfter = false }: NegateOptions = {},
): { answer: string; elided: boolean; de: boolean } | null {
  const [before, form, rest] = splitOnForm(ex.fr, ex.f);
  if (!form || /\s/.test(form)) return null;                       /* a compound form: not the présent's rule */
  if (/(^|\s)(ne|n['’])\s*\S|\bpas\b/i.test(ex.fr)) return null;   /* negative already; *plus* alone may be "more" */
  if (rest.startsWith('-')) return null;                         /* inverted: parle-t-il */
  const article = ARTICLE_TO_DE.exec(rest);
  if (article && !deAfter) return null;                          /* un/une/du/des → de is D.de-negative */
  if (!article && deAfter) return null;                          /* nothing for that rule to do */
  /* *être* never takes *de*: *ce n'est pas une voiture*. */
  if (article && /^(suis|es|est|sommes|êtes|sont)$/i.test(form)) return null;
  const after = article
    ? rest.replace(ARTICLE_TO_DE, (_m, _art: string | undefined, _elided: string | undefined, next: string) =>
      ` ${startsWithVowel(next) ? "d'" : 'de '}${next}`)
    : rest;
  const lead = before.replace(/\s+$/, '');
  const words = lead.toLowerCase().split(/\s+/);
  const last = words[words.length - 1] ?? '';
  if (last && OBJECT_PRONOUNS.has(last) && !SUBJECT_PRONOUNS.has(last)) return null;
  /* nous / vous before the verb: the subject, unless something stands
     before them that already is one (*il nous parle*). */
  if ((last === 'nous' || last === 'vous') && words.length > 1 && SUBJECT_PRONOUNS.has(words[words.length - 2] ?? '')) return null;
  const elided = startsWithVowel(form);
  /* *J'aime* is *je* elided before the verb; with *ne* between them the
     *je* is whole again: *Je n'aime pas*. */
  let subject = lead;
  const je = /([jJ])['’]$/.exec(lead);
  if (je) subject = `${lead.slice(0, -2)}${je[1] === 'J' ? 'Je' : 'je'}`;
  const ne = elided ? "n'" : 'ne ';
  const gap = subject ? ' ' : '';
  return { answer: `${subject}${gap}${ne}${form} ${word}${after}`, elided, de: !!article };
}

/** The rules the negation generator drills, each on the sentences it
 *  alone handles. */
export const NEGATION_RULE_IDS: readonly RuleId[] = ['G.pas', 'D.de-negative', 'G.others'];

/** The identity of a sentence's negation, for breadth: the verb, the
 *  corpus sentence, the rule. */
export const negationId = (key: string, sid: number, rule: RuleId = 'G.pas'): string =>
  `sentence:${key}:${sid}:${rule}`;

/** The negation exercise on one of a verb's sentences for a rule, or null
 *  where the sentence is not one the rule handles or has no corpus id.
 *  *G.pas* is one cell; *G.others* asks for *jamais* and *plus* in two;
 *  *D.de-negative* is the sentences the plain rule leaves out, one cell,
 *  observing both. */
export function negationFor(word: Pick<StudyWord, 'k' | 'conj'>, ex: Example, rule: RuleId = 'G.pas'): Instance | null {
  if (ex.id === undefined || !NEGATION_RULE_IDS.includes(rule)) return null;
  const elision = (made: { elided: boolean }): Obs[] => (made.elided ? [{ of: 'P.elision', on: 'form' }] : []);
  let cells: Cell[];
  let title: string;
  if (rule === 'G.others') {
    const never = negate(ex, { word: 'jamais' });
    const noLonger = negate(ex, { word: 'plus' });
    if (!never || !noLonger) return null;
    title = 'Say never, then no longer';
    cells = [
      { prompt: 'never', expected: never.answer, obs: [{ of: 'G.others', on: 'form' }, { of: 'G.pas', on: 'form' }, ...elision(never)] },
      { prompt: 'no longer', expected: noLonger.answer, obs: [{ of: 'G.others', on: 'form' }, { of: 'G.pas', on: 'form' }] },
    ];
  } else {
    const made = negate(ex, { deAfter: rule === 'D.de-negative' });
    if (!made) return null;
    title = 'Make it negative';
    const obs: Obs[] = [{ of: 'G.pas', on: 'form' }, ...elision(made)];
    if (made.de) obs.unshift({ of: 'D.de-negative', on: 'form' });
    cells = [{ prompt: '', expected: made.answer, obs }];
  }
  return {
    id: negationId(word.k, ex.id, rule), gen: 'negation', face: 'transform',
    spec: { key: word.k, sid: ex.id, rule }, genv: NEGATION_GENV, rule,
    title, hint: ex.en, cells, sentence: ex,
  };
}

/** Every negation exercise a verb offers for a rule: its présent sentences
 *  the rule handles. */
export const negationsFor = (word: Pick<StudyWord, 'k' | 'conj'>, rule: RuleId = 'G.pas'): Instance[] =>
  (word.conj?.examples?.pres ?? []).map((ex) => negationFor(word, ex, rule)).filter((i): i is Instance => i !== null);
