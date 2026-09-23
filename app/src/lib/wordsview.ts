/** The words screen's rules, away from the screen.
 *
 *  What the list shows for each of your words is not the record you typed:
 *  a word promoted out of the catalogue takes the catalogue's gender, IPA and
 *  recording, with your corrections over the top, and the list has to show
 *  exactly what the card will. It once showed a third thing — its own stored
 *  record — so a gender corrected here read one way in the list and another
 *  on the card (#22). `rowsFor` resolves every word the way the card does,
 *  and is tested against the database.
 *
 *  The form is here too: what it holds as it is typed, how it is read out of
 *  a record and back into one, and the one warning it gives.
 */
import { srcFor } from './audio.js';
import { userKey } from './keys.js';
import type { WordKey } from './keys.js';
import type {
  DictEntry, Gender, GrammaticalNumber, IndexEntry, StoredCard, StudyWord, UserWord,
} from './model.js';
import { listFields, missingFields } from './wordform.js';
import { anyWord, statusOf, toStudyWord } from './words.js';

/** The add-or-correct form, as it is typed: the English is one string here
 *  and a list once it is parsed. */
export interface WordForm {
  fr: string;
  en: string;
  pos: string;
  gender: Gender;
  number: GrammaticalNumber;
  note: string;
  /** Keep this as your own word rather than promoting the catalogue's. */
  own?: boolean;
}

export const EMPTY_FORM: WordForm = { fr: '', en: '', pos: 'noun', gender: '', number: '', note: '' };

/** The first few translations, as the list prints them. */
export const gloss = (w: { en?: string[] | string }, n = 3): string =>
  (Array.isArray(w.en) ? w.en : [w.en]).filter(Boolean).slice(0, n).join(' · ');

/** The English box, split: commas, semicolons and middle dots all separate
 *  translations, since that is how they are printed back. */
export const parseEn = (text: string): string[] =>
  text.split(/\s*[,;·]\s*/).map((e) => e.trim()).filter(Boolean);

/** A word laid out for correcting: your stored record on the words screen,
 *  or the word as the card shows it in the popup over a card — which for a
 *  catalogue word is the only record there is. Every translation, not the
 *  first three, since all of them are what is being edited. */
export function formOf(
  rec: Pick<UserWord, 'fr' | 'en' | 'pos' | 'gender' | 'number' | 'note'>,
): WordForm {
  return {
    fr: rec.fr, en: gloss(rec, 10), pos: rec.pos || 'other', gender: rec.gender ?? '',
    number: rec.number ?? '', note: rec.note ?? '',
  };
}

/** What the form says, in the shape a record takes. Gender and number are a
 *  noun's alone: a verb given a gender in the form is a verb with none. */
export function fromForm(form: WordForm): {
  fr: string; en: string[]; pos: string; gender: Gender; number: GrammaticalNumber; note: string;
} {
  const noun = form.pos === 'noun';
  return {
    fr: form.fr.trim(), en: parseEn(form.en), pos: form.pos,
    gender: noun ? form.gender : '', number: noun ? form.number : '', note: form.note,
  };
}

/** The one warning the form gives, or empty. A word with no English cannot
 *  be asked in either direction, so it is said once before it is saved;
 *  pressing again saves it anyway, half a word written down beating a word
 *  forgotten, and the list flags it afterwards. */
export function saveWarning(form: WordForm): string {
  const missing = missingFields({ fr: form.fr, en: parseEn(form.en) });
  if (!missing.length) return '';
  return `No ${listFields(missing)} yet — this card cannot be asked until it has one. Save it anyway?`;
}

/** Whether the form may be saved now, and what to say if not. The warning is
 *  given once: `standing` is the one already on the screen, and a press with
 *  it standing saves anyway, whatever the form still lacks. The warning the
 *  form should show afterwards comes back with the answer, so the screen holds
 *  no rule of its own about it — it used to, in two copies. */
export function guardSave(form: WordForm, standing: string): { proceed: boolean; warning: string } {
  const warning = saveWarning(form);
  if (!warning || standing) return { proceed: true, warning: '' };
  return { proceed: false, warning };
}

/** One of your words, as the list shows it. */
export interface WordRow {
  rec: UserWord;
  /** As the card will show it: the catalogue's record with your corrections
   *  on top, or your own record in the same shape. */
  shown: StudyWord;
  /** Something can be heard for it now, on this device. */
  playable: boolean;
  /** 'not started' | 'up next' | 'learning' | 'due' | 'known' — or 'skipped',
   *  for a word set aside from a card (#99), whatever its cards say. */
  status: string;
  /** Fields it still needs before it can be asked. */
  missing: string[];
}

/** Your words, each resolved the way the card resolves it. */
export async function rowsFor(
  words: readonly UserWord[], cards: readonly StoredCard[],
): Promise<WordRow[]> {
  const byKey = new Map<WordKey, UserWord>(words.map((w) => [w.k, w]));
  const rows: WordRow[] = [];
  for (const rec of words) {
    const shown = (await anyWord(rec.k, byKey).catch(() => null)) ?? toStudyWord(rec);
    rows.push({
      rec, shown,
      playable: !!(await srcFor(shown, 'fr')),
      status: rec.skipped ? 'skipped' : statusOf(rec.k, cards),
      missing: missingFields(rec),
    });
  }
  return rows;
}

/** One thing the search box found, and whether it is already in your list.
 *  A word found that is yours is still shown — the search used to leave it
 *  out, and a word you had added read as a word the catalogue did not have
 *  (#87) — with "in your list" where the Add button would be. */
export interface Offer<T> {
  item: T;
  /** The key the word has, or would have, in your list. */
  key: WordKey;
  inList: boolean;
}

/** What the search box offers: every catalogue hit and every dictionary
 *  entry found, each saying whether it is yours already. The dictionary's
 *  key is the one `addWord` would mint, so the flag is right before the
 *  word is added. */
export function offerings(
  hits: readonly IndexEntry[], found: readonly DictEntry[], mine: readonly Pick<UserWord, 'k'>[],
): { catalogue: Offer<IndexEntry>[]; dictionary: Offer<DictEntry>[] } {
  const keys = new Set(mine.map((w) => w.k));
  return {
    catalogue: hits.map((h) => ({ item: h, key: h.k, inList: keys.has(h.k) })),
    dictionary: found.map((d) => {
      const key = userKey(d.fr, d.pos);
      return { item: d, key, inList: keys.has(key) };
    }),
  };
}
