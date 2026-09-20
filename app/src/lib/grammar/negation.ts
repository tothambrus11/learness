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
import type { Instance } from './instance.js';

/** The analyser's version, on every attempt it labels. */
export const NEGATION_GENV = 1;

/** The sentences a verb offers: its présent examples with a corpus id, the
 *  id being what the exercise is known by across a catalogue rebuild. */
const OBJECT_PRONOUNS = new Set(['le', 'la', 'les', "l'", 'me', 'te', 'se', "m'", "t'", "s'", 'lui',
  'leur', 'y', 'en', 'nous', 'vous']);
const SUBJECT_PRONOUNS = new Set(['je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ce', "c'"]);
const ARTICLE_TO_DE = /^\s+(un|une|du|des|de la|de l')\b/i;

const startsWithVowel = (form: string): boolean => /^[aeiouyàâäéèêëïîôöùûüœh]/i.test(form);

/** The sentence made negative, or null where the rule alone does not do
 *  it. `elided` says whether *ne* became *n'*, for the labels. */
export function negate(ex: Pick<Example, 'fr' | 'f'>): { answer: string; elided: boolean } | null {
  const [before, form, after] = splitOnForm(ex.fr, ex.f);
  if (!form || /\s/.test(form)) return null;                       /* a compound form: not the présent's rule */
  if (/(^|\s)(ne|n['’])\s*\S|\bpas\b/i.test(ex.fr)) return null;   /* negative already */
  if (after.startsWith('-')) return null;                        /* inverted: parle-t-il */
  if (ARTICLE_TO_DE.test(after)) return null;                    /* un/une/du/des → de is D.de-negative */
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
  return { answer: `${subject}${gap}${ne}${form} pas${after}`, elided };
}

/** The identity of a sentence's negation, for breadth: the verb, the
 *  corpus sentence, the rule. */
export const negationId = (key: string, sid: number): string => `sentence:${key}:${sid}:G.pas`;

/** The negation exercise on one of a verb's sentences, or null where the
 *  sentence is not one the rule alone handles or has no corpus id. */
export function negationFor(word: Pick<StudyWord, 'k' | 'conj'>, ex: Example): Instance | null {
  if (ex.id === undefined) return null;
  const made = negate(ex);
  if (!made) return null;
  return {
    id: negationId(word.k, ex.id), gen: 'negation', face: 'transform',
    spec: { key: word.k, sid: ex.id }, genv: NEGATION_GENV, rule: 'G.pas',
    title: 'Make it negative', hint: ex.en,
    cells: [{
      prompt: '', expected: made.answer,
      obs: [{ of: 'G.pas', on: 'form' }, ...(made.elided ? [{ of: 'P.elision', on: 'form' as const }] : [])],
    }],
    sentence: ex,
  };
}

/** Every negation exercise a verb offers: its présent sentences the rule
 *  handles. */
export const negationsFor = (word: Pick<StudyWord, 'k' | 'conj'>): Instance[] =>
  (word.conj?.examples?.pres ?? []).map((ex) => negationFor(word, ex)).filter((i): i is Instance => i !== null);
