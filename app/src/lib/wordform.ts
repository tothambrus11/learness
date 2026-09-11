/** What a word you typed still needs, the order the list shows them in, and
 *  finding one among them. */

import { norm, stripArticle } from './check';
import { withDefiniteArticle } from './gender';
import type { StudyWord } from './types';

/** A word as this module takes it: a `UserWord`, or the half-filled form the
 *  words screen is still being typed into. Every field is optional, an
 *  incomplete form being the whole subject here. */
export interface WordRecord {
  /** The French as typed, article and all. */
  fr?: string;
  /** Translations, best first, or the one string a form field holds. */
  en?: string | string[];
  /** `noun` | `verb` | `adj` | `adv` | `phrase` | `other` | `unknown`. */
  pos?: string;
  /** `m` | `f` | `mf` | `''`. Only meaningful on a noun. */
  gender?: string;
  /** `pl` where the plural is the form worth teaching, else `''`. */
  number?: string;
  /** Whatever the learner wants to remember about it. */
  note?: string;
  /** Milliseconds when the word was first added; the list's second sort key. */
  addedAt?: number;
  /** A tombstone. A deleted record corrects nothing. */
  deleted?: boolean;
}

/** The names of the fields without which a card cannot be asked, `[]` when
 *  nothing is missing. */
export function missingFields(rec: WordRecord | null | undefined): string[] {
  const out = [];
  if (!(rec?.fr ?? '').trim()) out.push('French');
  const en = Array.isArray(rec?.en) ? rec.en : [rec?.en];
  if (!en.some((e) => (e ?? '').trim())) out.push('English');
  return out;
}

/** True where something a card needs is still blank. */
export const isIncomplete = (rec: WordRecord | null | undefined): boolean =>
  missingFields(rec).length > 0;

/** Your list as the words screen shows it: anything unfinished first, so it
 *  can be fixed, then the newest. A copy, so the list it was given keeps the
 *  order it had. */
export function sortForList<T extends WordRecord>(words: readonly T[]): T[] {
  return [...words].sort(
    (a, b) =>
      Number(isIncomplete(b)) - Number(isIncomplete(a)) || (b.addedAt ?? 0) - (a.addedAt ?? 0),
  );
}

/** Your list, narrowed to a query — French or English, with accents and
 *  articles ignored, so "bus" finds "le bus" and "ecole" finds "l'école". An
 *  empty query narrows nothing and comes back as a copy. */
export function matchWords<T extends WordRecord>(
  words: readonly T[] | null | undefined,
  query: string | null | undefined,
): T[] {
  const q = stripArticle(norm(query ?? ''));
  if (!q) return [...(words ?? [])];
  return (words ?? []).filter((w) => {
    const fr = norm(w.fr ?? '');
    const en = (Array.isArray(w.en) ? w.en : [w.en]).map((e) => norm(e ?? ''));
    return fr.includes(q) || stripArticle(fr).includes(q) || en.some((e) => e.includes(q));
  });
}

/** A catalogue word with the corrections you made to it laid on top: your value
 *  wins wherever you set one, and the catalogue keeps everything you did not
 *  touch — the recordings, the IPA, the verb tables and the examples. A
 *  recording made before a correction is dropped, since it no longer says what
 *  the word says. A record that is missing or deleted corrects nothing, and a
 *  null word stays null; both come back as the object that came in, not a
 *  copy. */
export function withCorrections(
  word: StudyWord | null,
  rec: WordRecord | null | undefined,
): StudyWord | null {
  if (!word) return word;
  if (!rec || rec.deleted) return word;
  const out = { ...word };
  const pos = rec.pos && rec.pos !== 'unknown' ? rec.pos : word.pos || '';
  const gender = rec.gender || word.gender || '';
  const number = rec.number || '';
  const en = (Array.isArray(rec.en) ? rec.en : []).filter((e) => (e ?? '').trim());
  if (en.length && en.join('|') !== (word.en ?? []).join('|')) {
    out.en = en;
    out.cue = en[0].split(';')[0].trim();
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
    out.audio = null;
    out.native = null;
  }
  return out;
}

/** "French, English" — for saying what is missing in a sentence. */
export const listFields = (fields: readonly string[]): string =>
  fields.length < 2
    ? (fields[0] ?? '')
    : `${fields.slice(0, -1).join(', ')} and ${fields.at(-1)}`;
