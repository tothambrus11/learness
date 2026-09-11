/** Words you bring yourself: from a tutor, a menu, a sign in the street. */

/* Two kinds, one list. A word the catalogue already has is promoted: its
   reading card is created now instead of whenever the ranking would have got
   there, and the catalogue's audio, IPA and verb tables come with it. A word
   the catalogue lacks is stored here with what you typed, and studied from
   that. Either way it goes to the front of the next sitting, ahead of the
   mined words, so a lesson simply pauses the catalogue for a day.

   The list syncs like everything else, and the MCP server writes the same
   records, so words added from a Claude conversation arrive here too. */
import { forgetSrc } from './audio';
import { search, word as catalogueWord } from './catalogue';
import { sameWord, stripArticle } from './check';
import { addLesson, allCards, db, deleteClipsFor, putCard, putUserWord, userWords } from './db';
import { withDefiniteArticle } from './gender';
import { entryRung, isActive } from './ladder';
import { emptyCard, isDue, isMature, State } from './scheduler';
import type {
  Card,
  CatalogueEntry,
  CatalogueWord,
  StudyWord,
  UserWord,
  WordKey,
} from './types';
import { missingFields, withCorrections } from './wordform';

/** The parts of speech a word can be filed under, in the order the form
 *  offers them. `unknown` is what a word typed without one gets. */
export const POS = ['noun', 'verb', 'adj', 'adv', 'phrase', 'other'] as const;

/** Singular unless the plural is the form worth teaching: "les gens", "les
 *  vacances", "les devoirs". */
export const NUMBERS = ['', 'pl'] as const;

/** Same key the MCP server makes, so the two never disagree about a word. */
export const userKey = (fr: string, pos: string): WordKey =>
  `${fr.trim().toLowerCase()}|${pos || 'unknown'}`;

/** The catalogue entry for exactly this French word, or null. Articles and
 *  pair forms are the same word either side: the catalogue's "le/la bus" is
 *  matched by "le/la bus", "le bus" and "bus" alike. */
export async function findInCatalogue(fr: string): Promise<CatalogueEntry | null> {
  /* Comparing the pair spelling literally was why "le/la bus" could not be
     added at all: it matched neither the catalogue nor itself, so the promotion
     silently fell through to a new, audio-less copy. `sameWord` settles it. */
  const hits = await search(fr, 8);
  return hits.find((h) => sameWord(h.fr, fr)) ?? null;
}

/** What the study screens need, built from a record you typed. Everything the
 *  catalogue would have supplied is empty rather than absent — no IPA, no
 *  recordings, level zero — so a card renders the same way whichever kind of
 *  word it is about. */
export function toStudyWord(rec: UserWord): StudyWord {
  const en = Array.isArray(rec.en)
    ? rec.en
    : String(rec.en || '')
        .split(/\s*[,;]\s*/)
        .filter(Boolean);
  /* Shown and typed the way the catalogue shows every noun — "l'erreur", not
     "une erreur" — so your own words follow the same convention. */
  const fr = withDefiniteArticle(rec.fr, rec.pos, rec.gender, rec.number);
  return {
    k: rec.k,
    fr,
    en,
    lvl: 0,
    lemma: stripArticle(rec.fr),
    answer: fr,
    pos: rec.pos || '',
    gender: rec.gender || '',
    number: rec.number || '',
    ipa: '',
    audio: null,
    native: null,
    cue: (en[0] || '').split(';')[0].trim(),
    cue_audio: null,
    note: rec.note || '',
    user: true,
    missing: missingFields(rec),
  };
}

/** The learner's list with the tombstones taken out — what every screen means
 *  by "your words". */
export async function activeUserWords(): Promise<UserWord[]> {
  return (await userWords()).filter((w) => !w.deleted);
}

/** Correct a word you added — its French, translations, part of speech, gender
 *  or note — without touching what it has earned. The key stays as it was, so
 *  the word's cards and reviews are untouched; only the record changes. Null
 *  for a key that is not in the list, or is only a tombstone. */
export async function editWord(
  key: WordKey,
  {
    fr,
    en,
    pos,
    gender,
    number,
    note,
  }: Partial<Omit<UserWord, 'k' | 'en'>> & {
    /** Translations, as a list or as one comma-separated string. */
    en?: string[] | string;
  } = {},
): Promise<UserWord | null> {
  /* The key is the word's identity for its cards and reviews, even though it
     was minted from the original spelling. The edit syncs like any other. */
  const rec = (await userWords()).find((w) => w.k === key);
  if (!rec || rec.deleted) return null;
  const next: UserWord = { ...rec, k: key, updatedAt: Date.now() };
  if (fr !== undefined && fr.trim()) next.fr = fr.trim();
  if (en !== undefined) {
    next.en = Array.isArray(en) ? en : en.split(/\s*[,;]\s*/).filter(Boolean);
  }
  if (pos !== undefined && pos) next.pos = pos;
  if (gender !== undefined) next.gender = gender;
  if (number !== undefined) next.number = number;
  if (note !== undefined) next.note = note;
  await putUserWord(next);
  /* A clip made for the old spelling says the old thing. It is not deleted —
     that left a card silently mute with nothing to press — but it no longer
     matches the word, so audio.js reports it out of date and every screen that
     shows the word offers to make it again. */
  forgetSrc(key);
  return next;
}

/** Resolve a key to a word: the catalogue's record with your corrections on
 *  top, or your own record where the catalogue has none. Null for a key that
 *  is in neither, which is a word deleted mid-sitting.
 *
 *  @param own the learner's list, passed in when resolving many words at once
 *             so the store is read a single time.
 */
export async function anyWord(
  key: WordKey,
  own: Map<WordKey, UserWord> | null = null,
): Promise<StudyWord | null> {
  const mine = own ?? new Map((await activeUserWords()).map((w) => [w.k, w]));
  const rec = mine.get(key);
  const c = await catalogueWord(key);
  if (c) return withCorrections(c, rec);
  return rec ? toStudyWord(rec) : null;
}

/** A word's live written card, and whether this call is what created it. */
interface EnsuredCard {
  /** The card, or null where the word's only rungs are retired ones — which
   *  cannot happen through the app, and is not worth guessing about. */
  card: Card | null;
  /** True when the card did not exist a moment ago. */
  made: boolean;
}

/** The written card a word starts on, made if it has none on any rung. A word
 *  from the catalogue enters at the rung its resemblance to English earns; one
 *  you typed yourself has no score and starts at the bottom. A word already met
 *  keeps its card and its history, and its live rung is marked as yours and
 *  made due. */
async function ensureWrittenCard(
  key: WordKey,
  lesson: string | undefined,
  word: Pick<CatalogueEntry, 'looks' | 'sounds'> | null = null,
): Promise<EnsuredCard> {
  /* A word you have already met is still a word you asked for, so making its
     live rung due puts it first in the next sitting rather than whenever the
     schedule would have got round to it. */
  const written = (await allCards()).filter((c) => c.key === key && c.channel === 'written');
  if (written.length) {
    const live = written.find(isActive);
    if (!live) return { card: null, made: false };
    const card: Card = {
      ...live,
      lesson: lesson || live.lesson || true,
      updatedAt: Date.now(),
    };
    if (!isDue(card)) card.due = new Date();
    await putCard(card);
    return { card, made: false };
  }
  const card = emptyCard(key, 'written', entryRung('written', word));
  card.lesson = lesson || true;
  card.updatedAt = Date.now();
  await putCard(card);
  return { card, made: true };
}

/** What was typed into the "add a word" form. */
export interface NewWordInput {
  /** The French, as typed. Required. */
  fr: string;
  /** Translations. May be empty; the form warns before saving one. */
  en?: string[];
  /** The part of speech, or `''` for unknown. */
  pos?: string;
  /** `m` | `f` | `mf` | `''`. Only meaningful on a noun. */
  gender?: string;
  /** `pl` where the plural is the form worth teaching. */
  number?: string;
  /** Anything worth remembering about it. */
  note?: string;
  /** The lesson this arrived with, for grouping. */
  lesson?: string;
  /** Keep what was typed even where the catalogue has the word: the way out
   *  when the catalogue's entry is a different sense or a different gender. */
  own?: boolean;
}

/** What adding a word did. */
export interface AddWordResult {
  /** The record as stored. */
  record: UserWord;
  /** True when the catalogue had the word, so it came with its audio. */
  promoted: boolean;
  /** True when the word already had a card: it kept its history and was
   *  brought forward rather than started from nothing. */
  known: boolean;
}

/** Add one word: promote it if the catalogue has it, otherwise keep what you
 *  typed. Re-adding a word keeps the date it was first added. */
export async function addWord({
  fr,
  en = [],
  pos = '',
  gender = '',
  number = '',
  note = '',
  lesson = '',
  own = false,
}: NewWordInput): Promise<AddWordResult> {
  /* `own` is the way out when the catalogue's entry is not the word you mean —
     a different sense, a different gender, a local usage. Without it a word the
     catalogue knows can only ever be promoted, and there was no way to keep
     your own. */
  const hit = own ? null : await findInCatalogue(fr);
  const now = Date.now();
  const rec: UserWord = hit
    ? {
        k: hit.k,
        fr: hit.fr,
        en: hit.en,
        pos: hit.k.split('|').pop() ?? '',
        gender: '',
        number: '',
        note,
        lesson,
        source: 'catalogue',
        updatedAt: now,
      }
    : {
        k: userKey(fr, pos),
        fr: fr.trim(),
        en,
        pos: pos || 'unknown',
        gender,
        number,
        note,
        lesson,
        source: 'app',
        updatedAt: now,
      };
  const previous = (await userWords()).find((w) => w.k === rec.k);
  if (previous && !previous.deleted) rec.addedAt = previous.addedAt;
  rec.addedAt ??= now;
  await putUserWord(rec);
  const { card, made } = await ensureWrittenCard(rec.k, lesson, hit);
  return { record: rec, promoted: !!hit, known: !!card && !made };
}

/** Remove a word from your list. A tombstone travels to the other devices.
 *  Cards of a word the catalogue also has are kept: it is still in the ranking,
 *  and its history is real. */
export async function removeWord(key: WordKey): Promise<void> {
  const rec = (await userWords()).find((w) => w.k === key);
  if (!rec) return;
  await putUserWord({ ...rec, deleted: true, updatedAt: Date.now() });
  await deleteClipsFor(key);
  forgetSrc(key);
  if (!(await catalogueWord(key))) {
    const d = await db();
    for (const c of await allCards()) if (c.key === key) await d.delete('cards', c.id);
  }
}

/** Words that arrived by sync or from the MCP server get their card on first
 *  sight. Returns only the cards made just now, so the caller can add them to
 *  a queue it has already built. */
export async function ensureCards(cards: readonly Card[]): Promise<Card[]> {
  const have = new Set(cards.filter((c) => c.channel === 'written').map((c) => c.key));
  const made: Card[] = [];
  for (const w of await activeUserWords()) {
    if (have.has(w.k)) continue;
    const hit: CatalogueWord | null = await catalogueWord(w.k);
    const ensured = await ensureWrittenCard(w.k, w.lesson, hit);
    if (ensured.made && ensured.card) made.push(ensured.card);
  }
  return made;
}

/** One line of a pasted lesson: the French, and the English if it was given. */
interface ParsedLine {
  /** The French side, always present — a line without one is dropped. */
  french: string;
  /** The English side, or `''` where the line was just a word. */
  english: string;
}

/** A pasted lesson list: one word per line, "french = english" optional.
 *  Records the lesson itself as well as the words, so the group survives. */
export async function addLessonText(text: string, label = ''): Promise<AddWordResult[]> {
  const lines = parseLessonPaste(text);
  const added: AddWordResult[] = [];
  for (const { french, english } of lines) {
    const en = english ? english.split(/\s*[,;]\s*/).filter(Boolean) : [];
    added.push(await addWord({ fr: french, en, lesson: label }));
  }
  if (added.length) {
    await addLesson({
      id: crypto.randomUUID(),
      label,
      addedAt: Date.now(),
      updatedAt: Date.now(),
      keys: added.map((a) => a.record.k),
    });
  }
  return added;
}

/** Split a pasted list into lines. The separator may be `=`, a tab, a
 *  semicolon, a bar or a spaced dash; blank lines and lines with no French are
 *  dropped. */
export function parseLessonPaste(text: string): ParsedLine[] {
  /* That set of separators is what people actually paste. */
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.split(/\s*[=\t;|]\s*|\s+[-–—]\s+/);
      return { french: (m[0] || '').trim(), english: (m[1] || '').trim() };
    })
    .filter((x) => x.french);
}

/** Where one of your words stands, as the list labels it. */
export type WordStatus = 'not started' | 'up next' | 'known' | 'due' | 'learning';

/** Where each of your words stands, for the list. Reads the live written rung
 *  only: a retired rung is history, not status. */
export function statusOf(key: WordKey, cards: readonly Card[]): WordStatus {
  const c = cards.find((x) => x.key === key && x.channel === 'written' && isActive(x));
  if (!c) return 'not started';
  if (c.state === State.New) return 'up next';
  if (isMature(c)) return 'known';
  return isDue(c, new Date()) ? 'due' : 'learning';
}
