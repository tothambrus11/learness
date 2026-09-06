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
import { forgetSrc } from './audio.js';
import { acceptedAnswers, norm, stripArticle } from './check.js';
import { withDefiniteArticle } from './gender.js';
import { entryRung, isActive } from './ladder.js';
import { emptyCard, isDue, isMature, State } from './scheduler.js';

export const POS = ['noun', 'verb', 'adj', 'adv', 'phrase', 'other'];

/** Same key the MCP server makes, so the two never disagree about a word. */
export const userKey = (fr, pos) => `${fr.trim().toLowerCase()}|${pos || 'unknown'}`;

/* A catalogue entry stored as "le/la ministre" is either article, so what you
   typed is compared against each form it accepts, not the pair spelling. */
const bare = (s) => stripArticle(norm(s));
const same = (stored, typed) => acceptedAnswers(stored).some((f) => bare(f) === bare(typed));

/** The catalogue entry for exactly this French word, if there is one. */
export async function findInCatalogue(fr) {
  const hits = await search(fr, 8);
  return hits.find((h) => same(h.fr, fr)) ?? null;
}

/** What the study screens need, built from a record you typed. */
export function toStudyWord(rec) {
  const en = Array.isArray(rec.en) ? rec.en : String(rec.en || '').split(/\s*[,;]\s*/).filter(Boolean);
  /* Shown and typed the way the catalogue shows every noun — "l'erreur", not
     "une erreur" — so your own words follow the same convention. */
  const fr = withDefiniteArticle(rec.fr, rec.pos, rec.gender);
  return {
    k: rec.k, fr, en, lvl: 0, lemma: stripArticle(rec.fr), answer: fr,
    pos: rec.pos || '', gender: rec.gender || '', ipa: '', audio: null, native: null,
    cue: (en[0] || '').split(';')[0].trim(), cue_audio: null, note: rec.note || '', user: true,
  };
}

export async function activeUserWords() {
  return (await userWords()).filter((w) => !w.deleted);
}

/** Correct a word you added — its French, translations, part of speech, gender
 *  or note — without touching what it has earned. The key is the word's
 *  identity for its cards and reviews and stays as it was, even though it was
 *  minted from the original spelling; only the record changes, and the change
 *  syncs like any other edit. */
export async function editWord(key, { fr, en, pos, gender, note } = {}) {
  const rec = (await userWords()).find((w) => w.k === key);
  if (!rec || rec.deleted) return null;
  const next = { ...rec, k: key, updatedAt: Date.now() };
  if (fr !== undefined && fr.trim()) next.fr = fr.trim();
  if (en !== undefined) next.en = Array.isArray(en) ? en : String(en).split(/\s*[,;]\s*/).filter(Boolean);
  if (pos !== undefined && pos) next.pos = pos;
  if (gender !== undefined) next.gender = gender;
  if (note !== undefined) next.note = note;
  await putUserWord(next);
  if (next.fr !== rec.fr) {
    /* A clip made for the old spelling says the old thing. */
    await deleteClipsFor(key);
    forgetSrc(key);
  }
  return next;
}

/** Resolve a key to a word: the catalogue first, then your own list. */
export async function anyWord(key, own = null) {
  const c = await catalogueWord(key);
  if (c) return c;
  const mine = own ?? new Map((await activeUserWords()).map((w) => [w.k, w]));
  const rec = mine.get(key);
  return rec ? toStudyWord(rec) : null;
}

/** The written card a word starts on, made if it has none on any rung. A word
 *  from the catalogue enters where its resemblance to English earns; one you
 *  typed yourself has no score and starts at the bottom. */
async function ensureWrittenCard(key, lesson, word = null) {
  if ((await allCards()).some((c) => c.key === key && c.channel === 'written')) return null;
  const card = emptyCard(key, 'written', entryRung('written', word));
  card.lesson = lesson || true;
  card.updatedAt = Date.now();
  await putCard(card);
  return card;
}

/** Add one word: promote it if the catalogue has it, otherwise keep what you typed. */
export async function addWord({ fr, en = [], pos = '', gender = '', note = '', lesson = '' }) {
  const hit = await findInCatalogue(fr);
  const now = Date.now();
  const rec = hit
    ? { k: hit.k, fr: hit.fr, en: hit.en, pos: hit.k.split('|').pop(), gender: '',
        note, lesson, source: 'catalogue', updatedAt: now }
    : { k: userKey(fr, pos), fr: fr.trim(), en, pos: pos || 'unknown', gender, note, lesson,
        source: 'app', updatedAt: now };
  const previous = (await userWords()).find((w) => w.k === rec.k);
  if (previous && !previous.deleted) rec.addedAt = previous.addedAt;
  rec.addedAt ??= now;
  await putUserWord(rec);
  await ensureWrittenCard(rec.k, lesson, hit);
  return { record: rec, promoted: !!hit };
}

/** Remove a word from your list. A tombstone travels to the other devices.
 *  Cards of a word the catalogue also has are kept: it is still in the ranking,
 *  and its history is real. */
export async function removeWord(key) {
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

/** Words that arrived by sync or from the MCP server get their card on first sight. */
export async function ensureCards(cards) {
  const have = new Set(cards.filter((c) => c.channel === 'written').map((c) => c.key));
  const made = [];
  for (const w of await activeUserWords()) {
    if (have.has(w.k)) continue;
    const hit = await catalogueWord(w.k);
    const card = await ensureWrittenCard(w.k, w.lesson, hit);
    if (card) made.push(card);
  }
  return made;
}

/** A pasted lesson list: one word per line, "french = english" optional. */
export async function addLessonText(text, label = '') {
  const lines = parseLessonPaste(text);
  const added = [];
  for (const { french, english } of lines) {
    const en = english ? english.split(/\s*[,;]\s*/).filter(Boolean) : [];
    added.push(await addWord({ fr: french, en, lesson: label }));
  }
  if (added.length) {
    await addLesson({ id: crypto.randomUUID(), label, addedAt: Date.now(), updatedAt: Date.now(),
      keys: added.map((a) => a.record.k) });
  }
  return added;
}

export function parseLessonPaste(text) {
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

/** Where each of your words stands, for the list. */
export function statusOf(key, cards) {
  const c = cards.find((x) => x.key === key && x.channel === 'written' && isActive(x));
  if (!c) return 'not started';
  if (c.state === State.New) return 'up next';
  if (isMature(c)) return 'known';
  return isDue(c, new Date()) ? 'due' : 'learning';
}
