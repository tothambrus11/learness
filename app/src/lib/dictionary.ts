/** Every French word the pipeline glosses, whether or not it teaches it.
 *
 *  The catalogue is a curriculum, five thousand words deep and ordered. That
 *  answers "what next" and not "my tutor said *chaussette* today", which is
 *  what the words screen is for: adding one meant typing its English, its part
 *  of speech and its gender from memory, and a word typed from memory teaches
 *  whatever was remembered. So the pipeline ships what it passed over as well,
 *  and a word added from here arrives with its article, its glosses, its part
 *  of speech, its gender and its transcription already filled in — everything
 *  a card shows but the recording, which the device's own voice makes.
 *
 *  It is far bigger than the catalogue and almost none of it is ever wanted,
 *  so it is one file per first letter, fetched when someone types that letter
 *  and kept by the service worker afterwards. The index is never loaded: the
 *  letter typed *is* the index. That is also the one thing this cannot do —
 *  look a word up by its English, which would mean every shard — and the
 *  catalogue, which is loaded whole, still searches both ways.
 *
 *  A catalogue built before the dictionary existed, or built without the
 *  extract, ships none. Then `shipped()` is false and the screen says so,
 *  rather than fetching a file that is not there.
 */
import { base } from '$app/paths';
import { meta } from './catalogue.js';
import { report } from './diagnostics.js';
import type { WordKey } from './keys.js';
import { lemmaOf } from './keys.js';
import type { Conjugation, DictEntry } from './model.js';
import { queryOf, score, shardOf } from './wordsearch.js';

/* A dictionary entry is a record like the others, declared in model.ts where
   the server can read it too; the screen still finds it here. */
export type { DictEntry } from './model.js';

/* The shard rule is a search rule, in wordsearch.ts, where the server reads it
   too; the screen still finds it here. */
export { OTHER, shardOf } from './wordsearch.js';

const shards = new Map<string, Promise<DictEntry[]>>();
const tables = new Map<string, Promise<Record<string, Conjugation>>>();

/** Does this catalogue ship a dictionary at all, and how big is it? `tables`
 *  is the letters with a file of verb tables, none on an older catalogue. */
export async function shipped(): Promise<{ words: number; letters: string[]; tables: string[] } | null> {
  const m = await meta().catch(() => null);
  const d = m?.dictionary;
  return d?.letters?.length ? { words: d.words, letters: d.letters, tables: d.tables ?? [] } : null;
}

/** The table of a verb the dictionary knows, or null: for a verb the
 *  catalogue does not teach, added from the dictionary, so it has its forms
 *  like one from the curriculum (#91). Null for anything that is not a verb,
 *  for a catalogue that ships no tables, and for a letter that has none;
 *  a file that will not fetch is written down and is null too. */
export async function tableOf(key: WordKey): Promise<Conjugation | null> {
  if (!key.endsWith('|verb')) return null;
  const letter = shardOf(lemmaOf(key));
  const have = await shipped();
  if (!have || !have.tables.includes(letter)) return null;
  let loading = tables.get(letter);
  if (!loading) {
    loading = (async () => {
      const res = await fetch(`${base}/catalogue/dict-conj-${letter}.json`);
      if (!res.ok) {
        report('dictionary', `dict-conj-${letter}.json could not be fetched (${res.status})`);
        tables.delete(letter);
        return {};
      }
      /* Shipped JSON, trusted to be the shape the pipeline writes, once. */
      return ((await res.json()) as { tables: Record<string, Conjugation> }).tables ?? {};
    })().catch((err: unknown) => {
      report('dictionary', `the ${letter} verb tables could not be read: ${String(err)}`);
      tables.delete(letter);
      return {};
    });
    tables.set(letter, loading);
  }
  return (await loading)[key] ?? null;
}

async function load(letter: string): Promise<DictEntry[]> {
  let have = shards.get(letter);
  if (!have) {
    have = (async () => {
      const res = await fetch(`${base}/catalogue/dict-${letter}.json`);
      if (!res.ok) {
        report('dictionary', `dict-${letter}.json could not be fetched (${res.status})`);
        /* Not remembered as empty: a 503 from a server restarting would
           otherwise blank that letter until the app is reloaded. */
        shards.delete(letter);
        return [];
      }
      /* Shipped JSON, trusted to be the shape the pipeline writes, once. */
      return ((await res.json()) as { words: DictEntry[] }).words ?? [];
    })().catch((err: unknown) => {
      report('dictionary', `the ${letter} words could not be read: ${String(err)}`);
      shards.delete(letter);      /* a dropped connection is worth trying again */
      return [];
    });
    shards.set(letter, have);
  }
  return have;
}

/** The dictionary's best answers to what was typed.
 *
 *  Empty where no dictionary is shipped, where the letter has no file, or
 *  where nothing matches — all three are "nothing to offer", and the screen
 *  says the same thing about each.
 */
export async function lookup(query: string, limit = 6): Promise<DictEntry[]> {
  const q = queryOf(query);
  if (!q.word) return [];
  const letter = shardOf(query);
  const have = await shipped();
  if (!have || !have.letters.includes(letter)) return [];
  const words = await load(letter);
  const hits: { w: DictEntry; score: number }[] = [];
  for (const w of words) {
    const s = score(q, w.fr, w.en);
    if (s > 0) hits.push({ w, score: s });
  }
  hits.sort((a, b) => b.score - a.score || a.w.fr.length - b.w.fr.length
    || a.w.fr.localeCompare(b.w.fr));
  return hits.slice(0, limit).map((h) => h.w);
}

/** Forget what has been fetched. For tests, and for a catalogue that changed
 *  under the app. */
export function forget(): void {
  shards.clear();
  tables.clear();
}
