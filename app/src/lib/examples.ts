/** Example sentences for one tense of one verb. */

import type { Conjugation, Example } from './types';

/** The sentences for one tense, with the line that must be shown beside them. */
export interface FoundExamples {
  /** The sentences themselves, in the order the catalogue ships them. Empty
   *  where the pipeline found none for this tense. */
  examples: Example[];
  /** The attribution to print, or `''` when there is nothing to attribute. */
  source: string;
}

/** The examples for one tense of one verb: `conj` is the verb's table as
 *  shipped in the catalogue, and `tense` a group id ("pres", "subj") or a
 *  compound id ("pc"). A verb with no table at all, and a tense with no
 *  sentences, both come back empty rather than missing. */
export function examplesFor(
  conj: Pick<Conjugation, 'examples'> | null | undefined,
  tense: string,
): FoundExamples {
  const examples = conj?.examples?.[tense] ?? [];
  return { examples, source: examples.length ? 'Tatoeba, CC BY 2.0 FR' : '' };
}

/** A sentence cut in three around the form to highlight: what comes before it,
 *  the form exactly as it is spelt there, and what comes after. */
export type SentenceParts = [before: string, match: string, after: string];

/** A string as a literal inside a regular expression. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches `form` where it stands as a word of its own: at the start of the
 *  sentence or after a non-letter — the apostrophe in "j'ai" — and not run
 *  into by a letter, a hyphen in "allons-y" being fine. What came before it is
 *  group 1, the form as it is spelt there group 2. */
const wholeWord = (form: string): RegExp =>
  new RegExp(`(^|[^\\p{L}])(${escapeRegExp(form)})(?![\\p{L}])`, 'iu');

/** Split a sentence around the form it was found by, for highlighting.
 *  Returns [before, match, after]; match is '' when the form is not there
 *  as a whole word (it always should be). */
export function splitOnForm(sentence: string, form: string): SentenceParts {
  if (!form) return [sentence, '', ''];
  const m = wholeWord(form).exec(sentence);
  if (!m) return [sentence, '', ''];
  const start = m.index + m[1].length;
  return [sentence.slice(0, start), m[2], sentence.slice(start + m[2].length)];
}
