/** Example sentences for one tense of one verb. */

/* Today every example is a corpus sentence the pipeline found and shipped with
   the verb table (frcog/sentences.py: Tatoeba, matched form by form, with a
   context rule where the spelling is shared). This module is the one place the
   app asks for them, so a local language model can be plugged in here later
   without the table component knowing: generate a sentence around a form the
   table already fixes, check that the form is in it, and fall back to the
   corpus when it is not. The table is the oracle; the model only writes around
   it. */
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

/** Split a sentence around the form it was found by, for highlighting.
 *  Returns [before, match, after]; match is '' when the form is not there
 *  as a whole word (it always should be). */
export function splitOnForm(sentence: string, form: string): SentenceParts {
  if (!form) return [sentence, '', ''];
  const esc = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* A form can follow an apostrophe (j'ai) or start the sentence, and can be
     followed by a hyphen (allons-y) or punctuation. Letters on either side
     would make it part of another word. */
  const re = new RegExp(`(^|[^\\p{L}])(${esc})(?![\\p{L}])`, 'iu');
  const m = re.exec(sentence);
  if (!m) return [sentence, '', ''];
  const start = m.index + m[1].length;
  return [sentence.slice(0, start), m[2], sentence.slice(start + m[2].length)];
}
