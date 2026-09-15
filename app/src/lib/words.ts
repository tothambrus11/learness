/** Words you bring yourself: from a tutor, a menu, a sign in the street.
 *
 *  Two kinds, one list. A word the catalogue already has is *promoted*: its
 *  reading card is created now instead of whenever the ranking would have got
 *  there, and the catalogue's audio, IPA and verb tables come with it. A word
 *  the catalogue lacks is stored here with what you typed, and studied from
 *  that. Either way it goes to the front of the next sitting, ahead of the
 *  mined words, so a lesson simply pauses the catalogue for a day.
 *
 *  The list syncs like everything else, and the MCP server writes the same
 *  records, so words added from a Claude conversation arrive here too.
 */
import { search, word as catalogueWord } from './catalogue.js';
import { addLesson, allCards, db, deleteClipsFor, putCard, putUserWord, userWords }
  from './db.js';
import type { WordKey } from './keys.js';
import { trustWordKey } from './keys.js';
import type {
  Gender, GrammaticalNumber, IndexEntry, LadderCard, StoredCard, StudyWord, UserWord,
} from './model.js';
import { nowMs } from './units.js';
import { forgetSrc } from './audio.js';
import { sameWord, stripArticle } from './check.js';
import { withDefiniteArticle } from './gender.js';
import { entryChannel, entryRung, isActive } from './ladder.js';
import { emptyCard, isDue, isMature, State } from './scheduler.js';
import { missingFields, withCorrections } from './wordform.js';

export const POS = ['noun', 'verb', 'adj', 'adv', 'phrase', 'other'] as const;
/** Singular unless the plural is the form worth teaching: "les gens", "les
 *  vacances", "les devoirs". */
export const NUMBERS: GrammaticalNumber[] = ['', 'pl'];

/** Same key the MCP server makes, so the two never disagree about a word. */
export const userKey = (fr: string, pos: string): WordKey =>
  trustWordKey(`${fr.trim().toLowerCase()}|${pos || 'unknown'}`);

/** The catalogue entry for exactly this French word, if there is one.
 *
 *  Either side may be a pair form: the catalogue stores "le/la bus", and you
 *  may type that, "le bus" or "bus". All three are the one word, which is what
 *  sameWord settles. Comparing the pair spelling literally was why "le/la bus"
 *  could not be added at all: it matched neither the catalogue nor itself, so
 *  the promotion silently fell through to a new, audio-less copy.
 */
export async function findInCatalogue(fr: string): Promise<IndexEntry | null> {
  const hits = await search(fr, 8);
  return hits.find((h) => sameWord(h.fr, fr)) ?? null;
}

/** What the study screens need, built from a record you typed. */
export function toStudyWord(rec: UserWord): StudyWord {
  const en = Array.isArray(rec.en) ? rec.en
    : String(rec.en || '').split(/\s*[,;]\s*/).filter(Boolean);
  /* Shown and typed the way the catalogue shows every noun — "l'erreur", not
     "une erreur" — so your own words follow the same convention. */
  const fr = withDefiniteArticle(rec.fr, rec.pos, rec.gender, rec.number);
  return {
    k: rec.k, fr, en, lvl: 0, lemma: stripArticle(rec.fr), answer: fr,
    pos: rec.pos || '', gender: rec.gender || '', number: rec.number || '',
    ipa: rec.ipa ?? '', audio: null, native: null,
    cue: (en[0] ?? '').split(';')[0]!.trim(), cue_audio: null, note: rec.note || '', user: true,
    missing: missingFields(rec),
  };
}

export async function activeUserWords(): Promise<UserWord[]> {
  return (await userWords()).filter((w) => !w.deleted);
}

/** Correct a word you added — its French, translations, part of speech, gender
 *  or note — without touching what it has earned. The key is the word's
 *  identity for its cards and reviews and stays as it was, even though it was
 *  minted from the original spelling; only the record changes, and the change
 *  syncs like any other edit. */
export async function editWord(key: WordKey, { fr, en, pos, gender, number, note }: {
  fr?: string;
  en?: string[] | string;
  pos?: string;
  gender?: Gender;
  number?: GrammaticalNumber;
  note?: string;
} = {}): Promise<UserWord | null> {
  const rec = (await userWords()).find((w) => w.k === key);
  if (!rec || rec.deleted) return null;
  const next: UserWord = { ...rec, k: key, updatedAt: nowMs() };
  if (fr !== undefined && fr.trim()) next.fr = fr.trim();
  if (en !== undefined) next.en = Array.isArray(en) ? en : en.split(/\s*[,;]\s*/).filter(Boolean);
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
 *  top, or your own record where the catalogue has none. */
export async function anyWord(
  key: WordKey, own: ReadonlyMap<WordKey, UserWord> | null = null,
): Promise<StudyWord | null> {
  const mine = own ?? new Map((await activeUserWords()).map((w) => [w.k, w]));
  const rec = mine.get(key);
  const c = await catalogueWord(key);
  if (c) return withCorrections(c, rec);
  return rec ? toStudyWord(rec) : null;
}

/** The card a word starts on, made if it has none on any rung of its first
 *  channel. A word from the catalogue enters where its resemblance to English
 *  earns; one you typed yourself has no score and starts at the bottom; a
 *  function word starts on the sense channel, where it is met in a sentence. */
async function ensureEntryCard(
  key: WordKey, lesson: string | undefined, word: IndexEntry | StudyWord | null = null,
): Promise<LadderCard | null> {
  const channel = entryChannel(word);
  if ((await allCards()).some((c) => c.key === key && c.channel === channel)) return null;
  const card = emptyCard(key, channel, entryRung(channel, word));
  card.lesson = lesson || true;
  card.updatedAt = nowMs();
  await putCard(card);
  return card;
}

/** Add one word: promote it if the catalogue has it, otherwise keep what you typed. */
export async function addWord({ fr, en = [], pos = '', gender = '', number = '', ipa = '',
  note = '', lesson = '', own = false }: {
  fr: string;
  en?: string[];
  pos?: string;
  gender?: Gender;
  number?: GrammaticalNumber;
  /** Only something that knew has one: the dictionary ships it, a form does
   *  not ask for it. */
  ipa?: string;
  note?: string;
  lesson?: string;
  own?: boolean;
}): Promise<{ record: UserWord; promoted: boolean }> {
  /* `own` is the way out when the catalogue's entry is not the word you mean —
     a different sense, a different gender, a local usage. Without it a word the
     catalogue knows can only ever be promoted, and there was no way to keep
     your own. */
  const hit = own ? null : await findInCatalogue(fr);
  const now = nowMs();
  const rec: UserWord = hit
    ? { k: hit.k, fr: hit.fr, en: hit.en, pos: hit.k.split('|').pop() ?? '', gender: '', number: '',
        note, lesson, source: 'catalogue', updatedAt: now }
    : { k: userKey(fr, pos), fr: fr.trim(), en, pos: pos || 'unknown', gender, number, note, lesson,
        source: 'app', updatedAt: now, ...(ipa ? { ipa } : {}) };
  const previous = (await userWords()).find((w) => w.k === rec.k);
  if (previous && !previous.deleted && previous.addedAt) rec.addedAt = previous.addedAt;
  rec.addedAt ??= now;
  await putUserWord(rec);
  await ensureEntryCard(rec.k, lesson, hit);
  return { record: rec, promoted: !!hit };
}

/** Remove a word from your list. A tombstone travels to the other devices.
 *  Cards of a word the catalogue also has are kept: it is still in the ranking,
 *  and its history is real. */
export async function removeWord(key: WordKey): Promise<void> {
  const rec = (await userWords()).find((w) => w.k === key);
  if (!rec) return;
  await putUserWord({ ...rec, deleted: true, updatedAt: nowMs() });
  await deleteClipsFor(key);
  forgetSrc(key);
  if (!(await catalogueWord(key))) {
    const d = await db();
    for (const c of await allCards()) if (c.key === key) await d.delete('cards', c.id);
  }
}

/** Words that arrived by sync or from the MCP server get their card on first sight. */
export async function ensureCards(cards: readonly StoredCard[]): Promise<LadderCard[]> {
  const have = new Set(
    cards.filter((c) => c.channel === 'written' || c.channel === 'sense').map((c) => c.key));
  const made: LadderCard[] = [];
  for (const w of await activeUserWords()) {
    if (have.has(w.k)) continue;
    const hit = await catalogueWord(w.k);
    const card = await ensureEntryCard(w.k, w.lesson, hit);
    if (card) made.push(card);
  }
  return made;
}

/** A pasted lesson list: one word per line, "french = english" optional. */
export async function addLessonText(
  text: string, label = '',
): Promise<{ record: UserWord; promoted: boolean }[]> {
  const lines = parseLessonPaste(text);
  const added: { record: UserWord; promoted: boolean }[] = [];
  for (const { french, english } of lines) {
    const en = english ? english.split(/\s*[,;]\s*/).filter(Boolean) : [];
    added.push(await addWord({ fr: french, en, lesson: label }));
  }
  if (added.length) {
    await addLesson({ id: crypto.randomUUID(), label, addedAt: nowMs(), updatedAt: nowMs(),
      keys: added.map((a) => a.record.k) });
  }
  return added;
}

function parseLessonPaste(text: string): { french: string; english: string }[] {
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

/** Where each of your words stands, for the list: read off its written card,
 *  or its sense card for a function word, which has no written one. */
export function statusOf(key: WordKey, cards: readonly StoredCard[]): string {
  const c = cards.find((x) => x.key === key && x.channel === 'written' && isActive(x))
    ?? cards.find((x) => x.key === key && x.channel === 'sense' && isActive(x));
  if (!c) return 'not started';
  if (c.state === State.New) return 'up next';
  if (isMature(c)) return 'known';
  return isDue(c, new Date()) ? 'due' : 'learning';
}
