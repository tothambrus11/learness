/** The shipped catalogue, read on the server.
 *
 *  The Worker already serves the catalogue as static files; the connector
 *  reads the same files through the assets binding, so there is one catalogue
 *  and the server's idea of which words exist is the app's. Three files
 *  matter here: the index (every taught word, enough to match on), meta.json
 *  (which dictionary letters were shipped) and the dictionary shards, one
 *  letter at a time, exactly as the words screen fetches them.
 *
 *  Each file is fetched once per isolate and kept. A file that cannot be read
 *  is not remembered as empty — a 503 while the store restarts would blank the
 *  catalogue until the isolate died — and is reported as `null`, which every
 *  reader turns into a sentence rather than a silent "nothing matched".
 */
import type { CatalogueMeta, DictEntry, IndexEntry } from '../../app/src/lib/model.js';

/** Where the connector's tools get their view of the catalogue. `null` from
 *  any of these means "could not be read", never "empty". */
export interface Catalogue {
  index(): Promise<readonly IndexEntry[] | null>;
  meta(): Promise<CatalogueMeta | null>;
  /** The dictionary's words for one first letter (see `shardOf`). `null`
   *  where no dictionary is shipped or the file could not be read; `[]`
   *  where the letter has no file. */
  dictionary(letter: string): Promise<readonly DictEntry[] | null>;
}

/** Fetching a file. Only `fetch` is used of the binding, which is what makes
 *  a test's stand-in three lines. */
export type AssetReader = Pick<Fetcher, 'fetch'>;

const cache = new Map<string, Promise<unknown>>();

/** Forget every file read so far. For tests, which serve different
 *  catalogues to the same module. */
export const forgetCatalogue = (): void => cache.clear();

async function readJson<T>(assets: AssetReader | undefined, origin: string, name: string):
  Promise<T | null> {
  if (!assets) return null;
  const key = `${origin}/catalogue/${name}`;
  let pending = cache.get(key) as Promise<T | null> | undefined;
  if (!pending) {
    pending = (async () => {
      /* Shipped JSON, trusted to be the shape the pipeline writes, once, here. */
      const res = await assets.fetch(new Request(key));
      if (!res.ok) return null;
      return (await res.json()) as T;
    })().catch(() => null);
    cache.set(key, pending);
    /* A failure is answered but not kept: the next reader tries again. */
    void pending.then((value) => { if (value === null) cache.delete(key); });
  }
  return pending;
}

/** The catalogue as the Worker at `origin` ships it. */
export function catalogueOf(assets: AssetReader | undefined, origin: string): Catalogue {
  const index = async (): Promise<readonly IndexEntry[] | null> =>
    (await readJson<{ words: IndexEntry[] }>(assets, origin, 'index.json'))?.words ?? null;
  const meta = (): Promise<CatalogueMeta | null> =>
    readJson<CatalogueMeta>(assets, origin, 'meta.json');
  return {
    index,
    meta,
    async dictionary(letter) {
      const letters = (await meta())?.dictionary?.letters;
      if (!letters?.length) return null;
      if (!letters.includes(letter)) return [];
      return (await readJson<{ words: DictEntry[] }>(assets, origin, `dict-${letter}.json`))
        ?.words ?? null;
    },
  };
}
