/** The shipped word list: read-only, versioned, fetched in pieces.
 *
 *  A small index covers every word so manual entry can search the whole
 *  catalogue without downloading it. Full data, including conjugation tables,
 *  arrives one level at a time, which is also the unit the service worker
 *  caches for offline use.
 */
import { base } from '$app/paths';
import { report } from './diagnostics.js';
import { wordKey } from './keys.js';
import type { WordKey } from './keys.js';
import type { IndexEntry, StudyWord } from './model.js';
import type { Seconds } from './units.js';

/** What the pipeline says about the catalogue it built. */
export interface CatalogueMeta {
  v: number;
  generated: Seconds;
  levelSize: number;
  levels: number[];
  words: number;
  verbs: number;
  /** Share of running text the whole catalogue would reach. */
  ceiling: number;
  directions: string[];
  examples: string;
}

const url = (name: string): string => `${base}/catalogue/${name}`;

/* The catalogue is shipped JSON: it is trusted to be the shape the pipeline
   writes, and that trust is spent here, once, rather than at every reader. */
const fetchJson = async <T>(name: string): Promise<T> => {
  const res = await fetch(url(name));
  if (!res.ok) {
    /* A missing file used to be read as JSON and fail as a syntax error in
       the app's own HTML. Named here, so the note says which file. */
    report('catalogue', `${name} could not be fetched (${res.status})`);
    throw new Error(`The catalogue file ${name} could not be fetched (${res.status})`);
  }
  return (await res.json()) as T;
};

let metaPromise: Promise<CatalogueMeta> | null = null;
let indexPromise: Promise<IndexEntry[]> | null = null;
const levelCache = new Map<number, Promise<StudyWord[]>>();
const byKey = new Map<WordKey, StudyWord>();

export function meta(): Promise<CatalogueMeta> {
  if (!metaPromise) metaPromise = fetchJson<CatalogueMeta>('meta.json');
  return metaPromise;
}

export function index(): Promise<IndexEntry[]> {
  if (!indexPromise) {
    indexPromise = fetchJson<{ words: IndexEntry[] }>('index.json').then((d) => d.words);
  }
  return indexPromise;
}

export async function level(n: number): Promise<StudyWord[]> {
  let cached = levelCache.get(n);
  if (!cached) {
    cached = fetchJson<{ words: StudyWord[] }>(`level-${String(n).padStart(2, '0')}.json`)
      .then((d) => {
        for (const w of d.words) byKey.set(w.k, w);
        return d.words;
      });
    levelCache.set(n, cached);
  }
  return cached;
}

/** Full record for a word, loading its level if that has not happened yet. */
export async function word(key: WordKey): Promise<StudyWord | null> {
  const have = byKey.get(key);
  if (have) return have;
  const entry = (await index()).find((w) => w.k === key);
  if (!entry) return null;
  await level(entry.lvl);
  return byKey.get(key) ?? null;
}

const fold = (s: string | null | undefined): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z' ]+/g, ' ')
    .trim();

/* "le la" is what fold() makes of a "le/la" either-gender entry. */
const stripArticle = (s: string): string => s.replace(/^(le la|le|la|les|l'|un|une|des|du|de la|se|s')\s*/, '').trim();

/** Search for manual entry. Most words a tutor gives are already in here, so
 *  adding one is usually promoting it rather than creating it from nothing. */
export async function search(query: string, limit = 8): Promise<IndexEntry[]> {
  const q = stripArticle(fold(query));
  if (!q) return [];
  const words = await index();
  const hits: { w: IndexEntry; score: number }[] = [];
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

export { wordKey };
