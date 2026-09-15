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
import { queryOf, score } from './wordsearch.js';
import type { Seconds } from './units.js';

/** What the pipeline says about the catalogue it built. */
export interface CatalogueMeta {
  v: number;
  generated: Seconds;
  levelSize: number;
  levels: number[];
  words: number;
  /** Function words shipped beside the ranked ones; absent on an older catalogue. */
  functionWords?: number;
  verbs: number;
  /** Share of running text the whole catalogue would reach. */
  ceiling: number;
  directions: string[];
  examples: string;
  /** The words the ranking passed over, shipped a letter at a time for the
   *  words screen. Absent where the catalogue ships none — built before the
   *  dictionary existed, or built without the extract. */
  dictionary?: { letters: string[]; words: number };
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

/** The file a level's full records live in. Level 0 is not a level: it is
 *  the function words, which have no rank to be levelled by, so they ship in
 *  a file of their own and are loaded the same way. */
export const levelFile = (n: number): string =>
  n === 0 ? 'function.json' : `level-${String(n).padStart(2, '0')}.json`;

export async function level(n: number): Promise<StudyWord[]> {
  let cached = levelCache.get(n);
  if (!cached) {
    cached = fetchJson<{ words: StudyWord[] }>(levelFile(n))
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

/** Search for manual entry. Most words a tutor gives are already in here, so
 *  adding one is usually promoting it rather than creating it from nothing.
 *
 *  The whole index is in memory, so this looks in the English as well; the
 *  dictionary, which arrives a letter at a time, cannot. The scoring itself is
 *  wordsearch.ts, shared with it so the two lists rank the same query the same
 *  way. */
export async function search(query: string, limit = 8): Promise<IndexEntry[]> {
  const q = queryOf(query);
  if (!q.word) return [];
  const words = await index();
  const hits: { w: IndexEntry; score: number }[] = [];
  for (const w of words) {
    const s = score(q, w.fr, w.en);
    if (s > 0) hits.push({ w, score: s });
  }
  hits.sort((a, b) => b.score - a.score || a.w.lvl - b.w.lvl);
  return hits.slice(0, limit).map((h) => h.w);
}

export { wordKey };
