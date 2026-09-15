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
import type { Gender } from './model.js';
import { bare, queryOf, score } from './wordsearch.js';

/** One word as the dictionary ships it: what a card would show, what it means,
 *  and the two facts a form cannot guess. */
export interface DictEntry {
  /** As a card would show it, article and all: "la chaussette". A word whose
   *  article nothing could settle has none, and is the learner's to correct. */
  fr: string;
  /** The first few senses, primary first. */
  en: string[];
  pos: string;
  gender?: Gender;
  ipa?: string;
}

/** Where anything that does not start with a plain letter is filed. The
 *  pipeline files it the same way; `tests/test_webexport.py` says so on that
 *  side and `dictionary.test.ts` on this one. */
export const OTHER = 'other';

/** Which file a query would be answered from: the first letter of the word
 *  itself, with its accent taken off, so "Étable" and "etable" ask for the same
 *  one and "la chaussette" asks for c.
 *
 *  Exactly what `webexport.dict_shard` does on the other side — decompose, take
 *  the first character, keep it if it is a plain letter — because the two names
 *  have to be the same string or the fetch is a 404. */
export function shardOf(query: string): string {
  const first = bare(query).toLowerCase().normalize('NFD').slice(0, 1);
  return /^[a-z]$/.test(first) ? first : OTHER;
}

const shards = new Map<string, Promise<DictEntry[]>>();

/** Does this catalogue ship a dictionary at all, and how big is it? */
export async function shipped(): Promise<{ words: number; letters: string[] } | null> {
  const m = await meta().catch(() => null);
  const d = m?.dictionary;
  return d?.letters?.length ? { words: d.words, letters: d.letters } : null;
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
}
