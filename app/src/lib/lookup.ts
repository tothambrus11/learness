/** What a word on the screen is: the headwords a form comes from, with what
 *  each means, its gender and how it is said.
 *
 *  A sentence is made of forms — *appelle*, *mes*, *chevaux* — and what the
 *  app knows is headwords: the catalogue's words and the dictionary's, each
 *  under its singular or its infinitive. lexicon.ts guesses which headwords
 *  a form could be; this keeps the guesses something knows, in the order a
 *  learner most likely means them, and says how the form comes from each.
 *  Nothing found is an empty list, never an error: the popup still offers
 *  the form to be heard.
 */
import { index } from './catalogue.js';
import { entriesFor, verbsWithForm } from './dictionary.js';
import { report } from './diagnostics.js';
import { VERBS } from './essentials.js';
import { withDefiniteArticle } from './gender.js';
import { BEFORE_ADJECTIVE, NOUNS } from './possessives.js';
import type { WordKey } from './keys.js';
import { lemmaOf, wordKey } from './keys.js';
import { bases } from './lexicon.js';
import type { Base } from './lexicon.js';
import type { DictEntry, Gender, GrammaticalNumber, IndexEntry } from './model.js';
import { anyWord } from './words.js';

/** One headword a form comes from, as the popup shows it. */
export interface Sense {
  key: WordKey;
  /** As a card shows it, article and all: *la clé*. */
  fr: string;
  pos: string;
  /** Its first few senses, primary first. */
  en: string[];
  gender: Gender;
  number: GrammaticalNumber;
  /** How it is said, slashes and all, or empty where nothing recorded it. */
  ipa: string;
  /** How the form comes from it — "plural of", "a form of" — or empty
   *  where the form is the headword itself. */
  via: string;
}

/** The essential verbs' own forms, to their verb: the irregular ones no
 *  rule reaches and no table is filed under (*suis*, *ont*, *va*). */
const ESSENTIAL = new Map<string, string[]>();
for (const verb of VERBS) {
  for (const form of [...verb.present, verb.pp]) {
    for (const one of form.split('/').map((f) => f.trim().toLowerCase())) {
      const list = ESSENTIAL.get(one) ?? [];
      if (!list.includes(verb.inf)) list.push(verb.inf);
      ESSENTIAL.set(one, list);
    }
  }
}

/** The possessives sheet's nouns by spelling. */
const SHEET_NOUNS = new Map([...NOUNS, ...BEFORE_ADJECTIVE].map((n) => [n.fr, n]));

let byLemma: Promise<Map<string, IndexEntry[]>> | null = null;
/** The catalogue's index by headword, built once. */
function catalogueByLemma(): Promise<Map<string, IndexEntry[]>> {
  byLemma ??= index().then((entries) => {
    const map = new Map<string, IndexEntry[]>();
    for (const e of entries) {
      const lemma = lemmaOf(e.k).toLowerCase();
      map.set(lemma, [...(map.get(lemma) ?? []), e]);
    }
    return map;
  }).catch((err: unknown) => {
    byLemma = null;
    report('lookup', `the catalogue's index could not be read: ${String(err)}`);
    return new Map<string, IndexEntry[]>();
  });
  return byLemma;
}

const posOf = (key: WordKey): string => key.slice(key.lastIndexOf('|') + 1);

/** A catalogue word, with the learner's corrections on top, as a sense. */
async function fromCatalogue(key: WordKey, via: string): Promise<Sense | null> {
  const w = await anyWord(key);
  if (!w) return null;
  return { key, fr: w.fr, pos: w.pos || posOf(key), en: w.en.slice(0, 3), gender: w.gender ?? '',
    number: w.number ?? '', ipa: w.ipa ?? '', via };
}

const fromDictionary = (lemma: string, e: DictEntry, via: string): Sense => ({
  key: wordKey(lemma, e.pos), fr: e.fr, pos: e.pos, en: e.en.slice(0, 3), gender: e.gender ?? '',
  number: '', ipa: e.ipa ?? '', via,
});

/** The headwords a form on the screen comes from, most likely first, at
 *  most `limit`: the form as a headword itself; then the essential verbs it
 *  is a form of and the verbs whose tables have it; then every other guess
 *  (lexicon.ts `bases`) that the catalogue or the dictionary knows. The
 *  catalogue's record wins over the dictionary's for the same word, since
 *  it carries the learner's corrections. Each word once. Reads the
 *  catalogue's index, a level file per catalogue word found, and the
 *  dictionary's file for each first letter tried. */
export async function lookUp(form: string, limit = 3): Promise<Sense[]> {
  const guesses = bases(form);
  if (!guesses.length) return [];
  const word = guesses[0]!.lemma;
  const catalogue = await catalogueByLemma();
  const out = new Map<WordKey, Sense>();
  const full = (): boolean => out.size >= limit;

  const tryBase = async (base: Base): Promise<void> => {
    for (const e of catalogue.get(base.lemma) ?? []) {
      if (full()) return;
      if ((base.pos && posOf(e.k) !== base.pos) || out.has(e.k)) continue;
      const sense = await fromCatalogue(e.k, base.via);
      if (sense) out.set(e.k, sense);
    }
    for (const e of await entriesFor(base.lemma)) {
      if (full()) return;
      if (base.pos && e.pos !== base.pos) continue;
      const sense = fromDictionary(base.lemma, e, base.via);
      if (!out.has(sense.key)) out.set(sense.key, sense);
    }
  };

  const [same, ...rest] = guesses;
  await tryBase(same!);
  for (const inf of ESSENTIAL.get(word) ?? []) {
    if (full()) break;
    const before = out.size;
    const via = inf === word ? '' : 'a form of';
    await tryBase({ lemma: inf, pos: 'verb', via });
    /* Known to the verbs sheet if to nothing else: its own English. */
    const verb = VERBS.find((v) => v.inf === inf);
    const key = wordKey(inf, 'verb');
    if (out.size === before && verb && !out.has(key)) {
      out.set(key, { key, fr: inf, pos: 'verb', en: [verb.en], gender: '', number: '', ipa: '', via });
    }
  }
  for (const key of await verbsWithForm(word)) {
    if (!full()) await tryBase({ lemma: lemmaOf(key), pos: 'verb', via: 'a form of' });
  }
  for (const base of rest) {
    if (full()) break;
    await tryBase(base);
  }
  /* Last, the possessives sheet's own nouns, whose meaning and gender the
     sheet already knows: a word it set is never "not in the dictionary",
     whatever catalogue is deployed. */
  if (!out.size) {
    for (const base of guesses) {
      const noun = SHEET_NOUNS.get(base.lemma);
      if (!noun) continue;
      const key = wordKey(noun.fr, 'noun');
      const number = noun.plural ? 'pl' : '';
      out.set(key, { key, fr: withDefiniteArticle(noun.fr, 'noun', noun.gender, number), pos: 'noun',
        en: [noun.en], gender: noun.gender, number, ipa: '', via: base.via });
      break;
    }
  }
  return [...out.values()];
}
