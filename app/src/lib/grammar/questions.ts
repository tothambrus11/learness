/** The question generator: a statement of the learner's own verb, to ask
 *  with *est-ce que* (GRAMMAR.md, Q.yes-no).
 *
 *  Of the three ways to ask — intonation, *est-ce que*, inversion — this
 *  drills the one that is always right and never changes the verb: the
 *  statement, *est-ce que* in front, a question mark at the end. *Est-ce
 *  qu'* before a vowel is the elision rule at work. Over the corpus
 *  sentences the verb's card already shows, so the key cannot disagree
 *  with the lesson; a sentence that is a question already, or that has no
 *  subject before its verb, is not dealt.
 */
import { splitOnForm } from '../examples.js';
import type { Example, StudyWord } from '../model.js';
import type { Instance } from './instance.js';

/** The analyser's version, on every attempt it labels. */
export const QUESTION_GENV = 1;

const startsWithVowel = (s: string): boolean => /^[aeiouyàâäéèêëïîôöùûüœh]/i.test(s);

/** The statement as an *est-ce que* question, or null where the rule alone
 *  does not do it: a question already, an order, or a sentence with nothing
 *  before the verb to ask about. `elided` says *qu'*, for the labels. */
export function askWith(ex: Pick<Example, 'fr' | 'f'>): { answer: string; elided: boolean } | null {
  const fr = ex.fr.trim();
  if (/[?!]\s*$/.test(fr) || /est-ce/i.test(fr)) return null;
  const [before, form] = splitOnForm(fr, ex.f);
  if (!form || !before.trim()) return null;
  /* The statement, lower-cased where it began with a pronoun or an
     article, kept where it began with a name. */
  const body = fr.replace(/\s*[.…]+\s*$/, '');
  const first = body.slice(0, 1);
  const rest = body.slice(1);
  const lowered = /^(je|j'|j’|tu|il|ils|elle|elles|on|nous|vous|ce|c'|c’|le|la|les|l'|l’|un|une|des|mon|ma|mes|ton|ta|tes|son|sa|ses)\b/i.test(body)
    ? first.toLowerCase() + rest : body;
  const elided = startsWithVowel(lowered);
  return { answer: `Est-ce ${elided ? "qu'" : 'que '}${lowered} ?`, elided };
}

export const questionId = (key: string, sid: number): string => `sentence:${key}:${sid}:Q.yes-no`;

/** The exercise on one of a verb's sentences, or null. */
export function questionFor(word: Pick<StudyWord, 'k' | 'conj'>, ex: Example): Instance | null {
  if (ex.id === undefined) return null;
  const made = askWith(ex);
  if (!made) return null;
  return {
    id: questionId(word.k, ex.id), gen: 'question', face: 'transform',
    spec: { key: word.k, sid: ex.id }, genv: QUESTION_GENV, rule: 'Q.yes-no',
    title: 'Ask it, with est-ce que', hint: ex.en,
    cells: [{
      prompt: '', expected: made.answer,
      obs: [{ of: 'Q.yes-no', on: 'form' }, ...(made.elided ? [{ of: 'P.elision', on: 'form' as const }] : [])],
    }],
    sentence: ex,
  };
}

/** Every question exercise a verb offers: its présent sentences. */
export const questionsFor = (word: Pick<StudyWord, 'k' | 'conj'>): Instance[] =>
  (word.conj?.examples?.pres ?? []).map((ex) => questionFor(word, ex)).filter((i): i is Instance => i !== null);
