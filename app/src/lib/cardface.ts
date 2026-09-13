/** What is on a card, whichever card it is.
 *
 *  These are the decisions the study screen used to make inside its own
 *  template: which of a word's sentences this card blanks, where the blank
 *  falls in it, which English cue to read out, and which of the word's senses
 *  are worth printing under an answer that already says one of them.
 *
 *  They live here because they are the same answers for the card you are
 *  looking at and for the card you answered ten minutes ago. A card you look
 *  back at once showed less than it did when it was live — the verb's forms
 *  were missing — because "what the card shows" was written inside the branch
 *  that draws the grading buttons, and only the live card has those. Nothing
 *  here can tell the two apart: every function takes the card, and that is
 *  all it takes.
 */
import type { Example, StudyWord } from './model.js';
import type { StudyItem } from './queue.js';

/** The English prompt for a word: the short cue the catalogue ships, else the
 *  first translation, cut at the first semicolon — "day; daytime" is one cue,
 *  not two. */
export const cueOf = (word: StudyWord): string =>
  word.cue ?? (word.en[0] ?? '').split(';')[0]!.trim();

/** Which of the word's example sentences this card is about, or -1 for a word
 *  with none.
 *
 *  Chosen from the card's own rep count rather than at random, so looking back
 *  at a card shows the sentence you were actually asked, and a word met again
 *  next week is asked about a different one. */
export function sentenceAt(item: StudyItem | null | undefined): number {
  const ex = item?.word?.ex;
  if (!item || !ex?.length) return -1;
  return item.card.reps % ex.length;
}

/** The example sentence this card is about, or null. */
export function sentenceFor(item: StudyItem | null | undefined): Example | null {
  const at = sentenceAt(item);
  return at < 0 ? null : item?.word.ex?.[at] ?? null;
}

/** The sentence with its word taken out, as the text before and after the gap.
 *
 *  The form in the sentence is what is removed — "il s'agit" for "agir" — and
 *  it is matched on a letter boundary so that "l'an" does not blank the "an"
 *  inside "dans". A sentence whose form cannot be found comes back whole,
 *  which shows the learner a sentence rather than an empty card. */
export function blank(sentence: Example): { before: string; after: string } {
  const re = new RegExp(
    `(^|[^\\p{L}])(${sentence.f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}])`, 'iu');
  const m = re.exec(sentence.fr);
  if (!m) return { before: sentence.fr, after: '' };
  const at = m.index + (m[1] ?? '').length;
  return {
    before: sentence.fr.slice(0, at),
    after: sentence.fr.slice(at + (m[2] ?? '').length),
  };
}

/** The English senses worth adding to what the card already shows.
 *
 *  What the catalogue files under def.en are the word's translations in full,
 *  not definitions — English Wiktionary glosses a French word rather than
 *  defining it, which is why the French side reads like a dictionary and this
 *  one reads like a phrasebook. Printing all of them under "Definition" meant
 *  most cards repeated their own answer back, so the one already printed as
 *  the answer is dropped and what is left is called what it is.
 *
 *  def.en holds the first few translations unshortened and word.en holds all
 *  of them shortened, so taking the full ones first and then whatever else is
 *  left gives the longest form of every sense the word has.
 */
export function senses(word: StudyWord | null | undefined): string[] {
  const primary = (word?.en?.[0] ?? '').toLowerCase().trim();
  const seen = new Set<string>(primary ? [primary] : []);
  const out: string[] = [];
  for (const line of [...(word?.def?.en ?? []), ...(word?.en ?? [])]) {
    const text = line.replace(/\s+([,;])/g, '$1').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
