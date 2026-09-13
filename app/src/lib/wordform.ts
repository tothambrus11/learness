/** What a word you typed still needs, the order the list shows them in, and
 *  finding one among them.
 *
 *  Kept apart from words.js, which reaches the catalogue and the database, so
 *  that these rules can be tested on their own.
 */
import { norm, stripArticle } from './check.js';
import { withDefiniteArticle } from './gender.js';
import type { StudyWord, UserWord } from './model.js';

/** As much of a word as the form has been filled in with. Every field is
 *  optional because this is what is being checked. */
export type PartialWord = Partial<Omit<UserWord, 'en'>> & { en?: string[] | string };

/** The fields without which a card cannot be asked.
 *
 *  A word with no English has nothing to prompt with and nothing to accept: it
 *  used to be saveable, and then appeared in a sitting as a blank card that
 *  could not be answered. Saving one is still allowed — half a word written
 *  down beats a word forgotten — but it is warned about before it is saved,
 *  listed first afterwards, and flagged wherever it is shown.
 */
export function missingFields(rec: PartialWord | null | undefined): string[] {
  const out: string[] = [];
  if (!String(rec?.fr ?? '').trim()) out.push('French');
  const en = Array.isArray(rec?.en) ? rec.en : [rec?.en];
  if (!en.some((e) => String(e ?? '').trim())) out.push('English');
  return out;
}

export const isIncomplete = (rec: PartialWord | null | undefined): boolean =>
  missingFields(rec).length > 0;

/** Your list as the words screen shows it: anything unfinished first, so it
 *  can be fixed, then the newest. */
export function sortForList(words: readonly UserWord[]): UserWord[] {
  return [...words].sort((a, b) =>
    Number(isIncomplete(b)) - Number(isIncomplete(a)) || (b.addedAt ?? 0) - (a.addedAt ?? 0));
}

/** Your list, narrowed to a query — French or English, with accents and
 *  articles ignored, so "bus" finds "le bus" and "ecole" finds "l'école".
 *
 *  The search box used to reach only the catalogue, so the one thing you could
 *  do with a result was add it. Your own words answer the same box now, and
 *  they come with everything a word's row can do: correct it, hear it, drop it.
 */
export function matchWords(words: readonly UserWord[], query: string): UserWord[] {
  const q = stripArticle(norm(query ?? ''));
  if (!q) return [...words];
  return [...(words ?? [])].filter((w) => {
    const fr = norm(w.fr ?? '');
    const en = (Array.isArray(w.en) ? w.en : [w.en]).map((e) => norm(e ?? ''));
    return fr.includes(q) || stripArticle(fr).includes(q) || en.some((e) => e.includes(q));
  });
}

/** A catalogue word with the corrections you made to it laid on top.
 *
 *  Promoting a catalogue word copies its spelling and translations into your
 *  list, so the two agree until you change one — and from then on the card
 *  showed the catalogue's version and ignored yours, because the resolver
 *  looked the word up in the catalogue first and stopped there. Correcting a
 *  gender did nothing at all.
 *
 *  Your value wins wherever you set one. The catalogue keeps everything you
 *  did not touch, which is the part worth keeping: the recordings, the IPA,
 *  the verb tables and the example sentences.
 */
export function withCorrections(
  word: StudyWord | null | undefined,
  rec: UserWord | null | undefined,
): StudyWord | null {
  if (!word) return word ?? null;
  if (!rec || rec.deleted) return word;
  const out = { ...word };
  const pos = rec.pos && rec.pos !== 'unknown' ? rec.pos : (word.pos || '');
  const gender = rec.gender || word.gender || '';
  const number = rec.number || '';
  const en = (Array.isArray(rec.en) ? rec.en : []).filter((e) => String(e ?? '').trim());
  const first = en[0];
  if (first && en.join('|') !== (word.en ?? []).join('|')) {
    out.en = en;
    out.cue = first.split(';')[0]!.trim();
    /* The cue was recorded for the old English, so it no longer says this. */
    out.cue_audio = null;
  }
  if (rec.note) out.note = rec.note;
  out.pos = pos;
  out.gender = gender;
  out.number = number;
  const shown = withDefiniteArticle((rec.fr || '').trim() || word.fr, pos, gender, number);
  if (shown && shown !== word.fr) {
    out.fr = shown;
    out.answer = shown;
    /* A recording of the old spelling says the old thing. */
    out.audio = null;
    out.native = null;
  }
  return out;
}

/** "French, English" — for saying what is missing in a sentence. */
export const listFields = (fields: readonly string[]): string =>
  (fields.length < 2
    ? (fields[0] ?? '')
    : `${fields.slice(0, -1).join(', ')} and ${fields.at(-1) ?? ''}`);
