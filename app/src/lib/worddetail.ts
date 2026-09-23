/** Everything about one word, on one screen.
 *
 *  The words list shows a line per word and the card shows what the rung
 *  asks; neither is the place to read a word whole — how it is said, every
 *  sense it has, the sentences it stands in, its table, and where each of
 *  its cards has got to (#42). This module works that out once, as data,
 *  from the same records the card resolves, so the detail page shows exactly
 *  what the card will: the catalogue's record with your corrections on top,
 *  or your own record, or — for a word nothing teaches yet — the dictionary's.
 */
import { senses } from './cardface.js';
import { dueText, stateLabel, summarise } from './cardsview.js';
import type { ChannelView } from './cardsview.js';
import { allReviews, cardsFor } from './db.js';
import { lookup } from './dictionary.js';
import type { DictEntry } from './dictionary.js';
import { splitOnForm } from './examples.js';
import { CHANNELS, CHANNEL_LABEL, RUNGS, RUNG_LABEL, lemmaOf } from './keys.js';
import type { Channel, Rung, WordKey } from './keys.js';
import type { Gender, GrammaticalNumber, Review, StoredCard, StudyWord } from './model.js';
import { activeUserWords, anyWord, statusOf, toStudyWord, userKey } from './words.js';

/** A sentence the word stands in, cut around the word so it can be marked. */
export interface DetailExample {
  fr: string;
  en: string;
  before: string;
  mark: string;
  after: string;
}

/** Where one channel of the word has got to. */
export interface Ladder {
  channel: Channel;
  label: string;
  rung: Rung;
  rungLabel: string;
  /** Which rung of how many: "2 of 4". */
  step: number;
  of: number;
  /** 'new' | 'learning' | 'relearning' | 'review' | 'known'. */
  state: string;
  due: string;
  /** FSRS's memory half-life, in days. */
  stability: number;
  accuracy: number | null;
  answers: number;
  leech: boolean;
}

/** Where the record came from, which decides what can be done with it. */
export type Origin = 'catalogue' | 'mine' | 'dictionary';

export interface WordDetail {
  key: WordKey;
  fr: string;
  lemma: string;
  gender: Gender;
  number: GrammaticalNumber;
  pos: string;
  ipa: string;
  /** Every translation, not the first three. */
  en: string[];
  /** The English in full — "to be located; to be situated" — where it says
   *  more than the translations line already does. */
  senses: string[];
  /** French definitions, where the catalogue has them. */
  defs: string[];
  examples: DetailExample[];
  chunks: { fr: string; en: string }[];
  /** A function word's core sense, and the words it is chosen against. */
  sense: string;
  contrast: { key: WordKey; fr: string }[];
  hasForms: boolean;
  /** A function word: it has a sense line, and is said to be one. */
  little: boolean;
  origin: Origin;
  note: string;
  /** 'not started' | 'up next' | 'learning' | 'due' | 'known', as the list
   *  says it — or 'skipped' for a word set aside from a card (#99), which
   *  the page offers to ask again. */
  status: string;
  ladders: Ladder[];
}

const ladderOf = (view: ChannelView): Ladder => ({
  channel: view.channel,
  label: CHANNEL_LABEL[view.channel],
  rung: view.rung,
  rungLabel: RUNG_LABEL[view.rung],
  step: RUNGS[view.channel].indexOf(view.rung) + 1,
  of: RUNGS[view.channel].length,
  state: stateLabel(view),
  due: dueText(view.dueIn),
  stability: view.stability,
  accuracy: view.accuracy,
  answers: view.answers,
  leech: view.leech,
});

/** The word laid out whole, from its record and its cards. Pure: the page
 *  and the tests both call it with what they have. */
export function detailOf({ word, cards, reviews, origin, skipped = false, now = new Date() }: {
  word: StudyWord;
  cards: readonly StoredCard[];
  reviews: readonly Review[];
  origin: Origin;
  /** The learner has set the word aside (UserWord.skipped). */
  skipped?: boolean;
  now?: Date;
}): WordDetail {
  const own = cards.filter((c) => c.key === word.k);
  const row = summarise({ cards: own, reviews: reviews.filter((r) => r.key === word.k),
    wordOf: () => word, now })[0];
  const ladders = CHANNELS.map((ch) => row?.channels[ch]).filter((v): v is ChannelView => !!v)
    .map(ladderOf);
  return {
    key: word.k,
    fr: word.fr,
    lemma: word.lemma,
    gender: word.gender ?? '',
    number: word.number ?? '',
    pos: word.pos,
    ipa: word.ipa ?? '',
    en: word.en,
    senses: senses(word).filter((sense) => !word.en.includes(sense)),
    defs: word.def?.fr ?? [],
    examples: (word.ex ?? []).map((e) => {
      const [before, mark, after] = splitOnForm(e.fr, e.f);
      return { fr: e.fr, en: e.en, before, mark, after };
    }),
    chunks: word.chunks ?? [],
    sense: word.sense ?? '',
    contrast: (word.contrast ?? []).map((key) => ({ key, fr: lemmaOf(key) })),
    hasForms: !!word.conj?.groups?.length,
    little: word.kind === 'function',
    origin,
    note: word.note ?? '',
    /* On the clock the detail was given, not the wall's: the word page is
       read under a test's clock as well as a learner's, and this read the
       wall's for a day before a card fell due and said so. */
    status: skipped ? 'skipped' : statusOf(word.k, own, now),
    ladders,
  };
}

/** A dictionary entry in the shape a card would show it: the same record a
 *  word added from the dictionary becomes, so the page before adding and the
 *  card after agree. */
export const fromDictionary = (entry: DictEntry): StudyWord => toStudyWord({
  k: userKey(entry.fr, entry.pos), fr: entry.fr, en: entry.en, pos: entry.pos,
  gender: entry.gender ?? '', ...(entry.ipa ? { ipa: entry.ipa } : {}),
});

/** The word behind a key, wherever it is: the catalogue with your
 *  corrections, your own list, or the dictionary. The record comes back
 *  beside the detail, since the page still needs it whole — for the verb
 *  table, and for what to play. Null when nothing knows the key: one typed
 *  into the address bar, or a word since removed. */
export async function loadDetail(
  key: WordKey,
): Promise<{ word: StudyWord; detail: WordDetail } | null> {
  const [mine, cards, reviews] = await Promise.all([activeUserWords(), cardsFor(key), allReviews()]);
  const own = new Map(mine.map((w) => [w.k, w]));
  const known = await anyWord(key, own);
  if (known) {
    return { word: known,
      detail: detailOf({ word: known, cards, reviews, origin: known.user ? 'mine' : 'catalogue',
        skipped: !!own.get(key)?.skipped }) };
  }
  /* The dictionary is a letter at a time and searched by spelling, so the
     key's lemma is what it is asked for; the part of speech settles which
     of the entries it has for that spelling. */
  const found = (await lookup(lemmaOf(key), 20)).find((d) => userKey(d.fr, d.pos) === key);
  if (!found) return null;
  const word = fromDictionary(found);
  return { word, detail: detailOf({ word, cards, reviews, origin: 'dictionary' }) };
}

/** The address of a word's page. One place, so a link from the list, the
 *  search and the cards screen all spell it the same way. */
export const detailHref = (base: string, key: WordKey): string =>
  `${base}/word/?k=${encodeURIComponent(key)}`;
