/** The shipped word list: read-only, versioned, fetched in pieces. */

import { base } from '$app/paths';

import { wordKey } from './keys';
import type { CatalogueEntry, CatalogueMeta, CatalogueWord, WordKey } from './types';

/** Where a catalogue file lives, under the app's own base path. */
const url = (name: string): string => `${base}/catalogue/${name}`;

/** The header request, kept so that a second caller joins the first. */
let metaPromise: Promise<CatalogueMeta> | null = null;

/** The index request, likewise: it is fetched once per page load. */
let indexPromise: Promise<CatalogueEntry[]> | null = null;

/** One in-flight or settled request per level, so a level is fetched once. */
const levelCache = new Map<number, Promise<CatalogueWord[]>>();

/** Every full record seen so far, by key. Filled as levels arrive. */
const byKey = new Map<WordKey, CatalogueWord>();

/** The catalogue's header: how big it is and how far it reaches. Fetched
 *  once; the same promise is handed to every caller. */
export function meta(): Promise<CatalogueMeta> {
  metaPromise ??= fetch(url('meta.json')).then((r): Promise<CatalogueMeta> => r.json());
  return metaPromise;
}

/** Every word, in ranked order, with just enough on each to search and to
 *  schedule. Taking from the front of this is taking the easiest useful words. */
export function index(): Promise<CatalogueEntry[]> {
  indexPromise ??= fetch(url('index.json'))
    .then((r): Promise<{ words: CatalogueEntry[] }> => r.json())
    .then((d) => d.words);
  return indexPromise;
}

/** One level's full records, fetched once and remembered. Loading a level is
 *  also what fills `byKey`, which is how `word()` answers. */
export async function level(n: number): Promise<CatalogueWord[]> {
  let pending = levelCache.get(n);
  if (!pending) {
    pending = fetch(url(`level-${String(n).padStart(2, '0')}.json`))
      .then((r): Promise<{ words: CatalogueWord[] }> => r.json())
      .then((d) => {
        for (const w of d.words) byKey.set(w.k, w);
        return d.words;
      });
    levelCache.set(n, pending);
  }
  return pending;
}

/** Full record for a word, loading its level if that has not happened yet.
 *  Null for a key the catalogue does not list, which is every word the learner
 *  typed themselves. */
export async function word(key: WordKey): Promise<CatalogueWord | null> {
  const had = byKey.get(key);
  if (had) return had;
  const entry = (await index()).find((w) => w.k === key);
  if (!entry) return null;
  await level(entry.lvl);
  return byKey.get(key) ?? null;
}

/** Every level up to and including `n`, for offline downloads by level. */
export async function levelsUpTo(n: number): Promise<number[]> {
  const m = await meta();
  return m.levels.filter((l) => l <= n);
}

/** A string reduced to bare lowercase letters: accents stripped, punctuation
 *  and anything else turned into spaces. What both sides of a search are
 *  compared in. */
const fold = (s: string | null | undefined): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z' ]+/g, ' ')
    .trim();

/** The word without its article. "le la" is what `fold()` makes of a "le/la"
 *  either-gender entry, so it is stripped too. */
const stripArticle = (s: string): string =>
  s.replace(/^(le la|le|la|les|l'|un|une|des|du|de la|se|s')\s*/, '').trim();

/** Search for manual entry. An exact French match beats a prefix, a prefix
 *  beats a substring, and the French side beats the English; ties go to the
 *  commoner word. At most `limit` hits, best first. */
export async function search(query: string, limit = 8): Promise<CatalogueEntry[]> {
  const q = stripArticle(fold(query));
  if (!q) return [];
  const words = await index();
  const hits: { w: CatalogueEntry; score: number }[] = [];
  for (const w of words) {
    const fr = stripArticle(fold(w.fr));
    let score = 0;
    if (fr === q) score = 100;
    else if (fr.startsWith(q)) score = 80 - (fr.length - q.length);
    else if (fr.includes(q)) score = 50;
    else if (w.en.some((e) => fold(e) === q)) score = 40;
    else if (w.en.some((e) => fold(e).includes(q))) score = 20;
    if (score > 0) hits.push({ w, score });
  }
  hits.sort((a, b) => b.score - a.score || a.w.lvl - b.w.lvl);
  return hits.slice(0, limit).map((h) => h.w);
}

/** The key a word is filed under, re-exported so callers have one import. */
export { wordKey };
