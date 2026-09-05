/** The shipped word list: read-only, versioned, fetched in pieces.
 *
 *  A small index covers every word so manual entry can search the whole
 *  catalogue without downloading it. Full data, including conjugation tables,
 *  arrives one level at a time, which is also the unit the service worker
 *  caches for offline use.
 */
import { base } from '$app/paths';
import { wordKey } from './keys.js';

const url = (name) => `${base}/catalogue/${name}`;

let metaPromise = null;
let indexPromise = null;
const levelCache = new Map();
const byKey = new Map();

export function meta() {
  if (!metaPromise) metaPromise = fetch(url('meta.json')).then((r) => r.json());
  return metaPromise;
}

export function index() {
  if (!indexPromise) {
    indexPromise = fetch(url('index.json'))
      .then((r) => r.json())
      .then((d) => d.words);
  }
  return indexPromise;
}

export async function level(n) {
  if (!levelCache.has(n)) {
    const p = fetch(url(`level-${String(n).padStart(2, '0')}.json`))
      .then((r) => r.json())
      .then((d) => {
        for (const w of d.words) byKey.set(w.k, w);
        return d.words;
      });
    levelCache.set(n, p);
  }
  return levelCache.get(n);
}

/** Full record for a word, loading its level if that has not happened yet. */
export async function word(key) {
  if (byKey.has(key)) return byKey.get(key);
  const entry = (await index()).find((w) => w.k === key);
  if (!entry) return null;
  await level(entry.lvl);
  return byKey.get(key) ?? null;
}

export async function levelsUpTo(n) {
  const m = await meta();
  return m.levels.filter((l) => l <= n);
}

const fold = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z' ]+/g, ' ')
    .trim();

/* "le la" is what fold() makes of a "le/la" either-gender entry. */
const stripArticle = (s) => s.replace(/^(le la|le|la|les|l'|un|une|des|du|de la|se|s')\s*/, '').trim();

/** Search for manual entry. Most words a tutor gives are already in here, so
 *  adding one is usually promoting it rather than creating it from nothing. */
export async function search(query, limit = 8) {
  const q = stripArticle(fold(query));
  if (!q) return [];
  const words = await index();
  const hits = [];
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
