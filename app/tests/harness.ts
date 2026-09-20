/** The app, freshly started, with a real database and a stubbed catalogue.
 *
 *  These are not unit tests of a pure function: they drive db.ts, words.ts and
 *  session.ts as the app does, against fake-indexeddb — which is a complete
 *  implementation of IndexedDB, not a stand-in — and a `fetch` that serves a
 *  catalogue of a few words. That is the layer the day's bug lived in: every
 *  piece was individually right, and the query between them asked for the
 *  wrong thing.
 *
 *  Each call gives a database with nothing in it and a module graph that has
 *  never seen one, because both hold state: the database keeps what was
 *  written, and db.ts keeps the open connection.
 */
/* Sets IndexedDB's globals — IDBRequest, IDBKeyRange and the rest — which the
   idb wrapper reaches for by name. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import type { IndexEntry, StudyWord } from '../src/lib/model.js';
import { asked, entry, word } from './make.js';

export interface App {
  db: typeof import('../src/lib/db.js');
  words: typeof import('../src/lib/words.js');
  session: typeof import('../src/lib/session.js');
  catalogue: typeof import('../src/lib/catalogue.js');
  progress: typeof import('../src/lib/progress.js');
  /** Every request the app made, in order, for asserting on what it fetched. */
  fetched: string[];
}

/* Real words, because searching folds away anything that is not a letter: a
   catalogue of "w0", "w1" is one word repeated as far as the search box is
   concerned. In frequency order, commonest first, as the pipeline ranks. */
const NOUNS = [
  ['temps', 'time'], ['jour', 'day'], ['monde', 'world'], ['homme', 'man'],
  ['pays', 'country'], ['train', 'train'], ['livre', 'book'], ['route', 'road'],
  ['ville', 'town'], ['enfant', 'child'], ['gare', 'station'], ['pont', 'bridge'],
] as const;

/** A small catalogue, ranked easiest-first like the real one. */
/** What a stubbed catalogue serves: the index, the one level file every
 *  ranked word lives in, and the function words' file, empty unless a test
 *  puts some in. */
export interface StubCatalogue {
  index: IndexEntry[];
  words: StudyWord[];
  functionWords?: StudyWord[];
}

export function smallCatalogue(size = 6): StubCatalogue {
  const index: IndexEntry[] = [];
  const full: StudyWord[] = [];
  for (let i = 0; i < Math.min(size, NOUNS.length); i += 1) {
    const [fr, en] = NOUNS[i]!;
    const k = `${fr}|noun`;
    /* Descending mass: the front of the index is the commonest words, which is
       what makes "the app keeps dealing easy words" a thing that can happen. */
    index.push(entry({ k, fr: `le ${fr}`, en: [en], lvl: 1, m: (size - i) / 1000, looks: 0.1 }));
    full.push(word({ k, fr: `le ${fr}`, answer: `le ${fr}`, lemma: fr, en: [en],
      lvl: 1, pos: 'noun', gender: 'm' }));
  }
  return { index, words: full };
}

export async function freshApp({ catalogue = smallCatalogue() }: { catalogue?: StubCatalogue } = {}): Promise<App> {
  globalThis.indexedDB = new IDBFactory();
  const fetched: string[] = [];
  const body = (data: unknown): Response =>
    new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
    const url = asked(input);
    fetched.push(url);
    if (url.endsWith('/catalogue/meta.json')) {
      return body({ v: 1, recipe: 'fixture', levelSize: 100, levels: [1], words: catalogue.index.length,
        verbs: 0, ceiling: 0.5, directions: [], examples: '' });
    }
    if (url.endsWith('/catalogue/index.json')) return body({ v: 1, words: catalogue.index });
    if (/\/catalogue\/level-\d+\.json$/.test(url)) {
      return body({ v: 1, level: 1, words: catalogue.words });
    }
    if (url.endsWith('/catalogue/function.json')) {
      return body({ v: 1, level: 0, words: catalogue.functionWords ?? [] });
    }
    throw new Error(`nothing serves ${url} in a test`);
  });
  /* A fresh module graph, so db.ts does not hand back the connection it opened
     to the database of the previous test. */
  vi.resetModules();
  const [db, words, session, cat, progress] = await Promise.all([
    import('../src/lib/db.js'),
    import('../src/lib/words.js'),
    import('../src/lib/session.js'),
    import('../src/lib/catalogue.js'),
    import('../src/lib/progress.js'),
  ]);
  return { db, words, session, catalogue: cat, progress, fetched };
}
