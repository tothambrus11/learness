/** The records this app owns, and what each field means.
 *
 *  Four of them are written down and outlive any one version of the code — a
 *  card, a review, a word you added, a clip — so their shapes are declared
 *  once, here, rather than being implied by whichever screen happens to read
 *  them. Two rules run through all of it:
 *
 *  * A card holds the current state of one memory. It can be recomputed,
 *    merged and thrown away.
 *  * A review is what actually happened, is append-only, and is never edited.
 *    Anything a day needs to know that the card cannot answer afterwards is
 *    written into the review at the moment it happens.
 *
 *  Fields marked optional are genuinely absent on older rows, and readers must
 *  tell "absent" from "false" — `'met' in review` is a real question with a
 *  real answer, which is why `exactOptionalPropertyTypes` is on.
 */
import type { Rating, State } from 'ts-fsrs';
import type { Channel, CardId, Rung, WordKey } from './keys.js';
import type { DateLike, Millis, Seconds } from './units.js';

/* ---------------------------------------------------------------- cards -- */

/** The FSRS half of a card: its scheduling state, as ts-fsrs keeps it.
 *
 *  `due` and `last_review` are `DateLike` rather than `Date` because that is
 *  what comes back: IndexedDB returns the `Date` it stored, and a card pulled
 *  from another device arrives as JSON, where a date is a string. Read them
 *  with `whenMs`. */
export interface Schedule {
  due: DateLike;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: DateLike | null;
}

/** A card as stored.
 *
 *  `channel` and `rung` are optional because a card written before the ladder
 *  has neither — it has `direction` instead — and one can still arrive by sync
 *  from a device that has not migrated. `legacyToChannel` places those; every
 *  scheduling decision is made on a `LadderCard`, which has both.
 */
export interface StoredCard extends Schedule {
  id: CardId;
  key: WordKey;
  channel?: Channel;
  rung?: Rung;
  /** Pre-ladder cards only: one of DIRECTIONS. */
  direction?: string;
  /** A lower rung of the same channel, kept for its history. */
  retired?: boolean;
  /** When this device last wrote the card. The sync merges on it. */
  updatedAt?: Millis;
  /** Consecutive answers of Good or better on this card; the climb reads it. */
  streak?: number;
  /** Lapses have passed the threshold. */
  leech?: boolean;
  /** The word came from a lesson you pasted in; true when it had no label. */
  lesson?: string | true;
}

/** A card that has a place on the ladder — the only kind that is scheduled. */
export interface LadderCard extends StoredCard {
  channel: Channel;
  rung: Rung;
}

/* -------------------------------------------------------------- reviews -- */

/** One answer, as it goes into the log.
 *
 *  Everything here is a fact about the moment of answering. The three
 *  optional flags are written by the session because they cannot be recovered
 *  later — they are facts about the card as it was a moment before — and are
 *  absent on rows written before each was introduced, which is why a reader
 *  distinguishes absent from false.
 */
export interface Review {
  /** IndexedDB's own auto-increment key. Device-local: it means nothing on
   *  another device, and is stripped before a push. */
  i?: number;
  /** The identity of this answer everywhere. The sync merges on it. */
  uid: string;
  id: CardId;
  key: WordKey;
  channel?: Channel;
  rung?: Rung;
  /** "channel/rung", or one of the five pre-ladder directions. */
  direction: string;
  /** When, in seconds — the log's unit. */
  ts: Seconds;
  rating: Rating;
  /** How long the answer took, where the screen measured it. */
  ms: number | null;
  /** The card's state *before* this answer: what was being tested. */
  state: State;
  /** This answer took the word into "known". */
  learned?: boolean;
  /** This answer was the word's first exposure on any rung. */
  met?: boolean;
  /** The rung this answer climbed to, if it climbed. */
  promoted?: Rung | null;
  /** Said aloud and it came out wrong. Beside the rating, never part of it. */
  mispronounced?: boolean;
  /** Reserved by the sync for rows the server has seen. */
  synced?: boolean;
}

/* ---------------------------------------------------------------- words -- */

export type Gender = 'm' | 'f' | 'mf' | '';
export type GrammaticalNumber = '' | 'pl';

/** A word you added yourself, or promoted out of the catalogue. Synced. */
export interface UserWord {
  k: WordKey;
  fr: string;
  en: string[];
  pos: string;
  gender?: Gender;
  number?: GrammaticalNumber;
  /** How it is said, where something knew: a word taken from the dictionary
   *  brings the pipeline's transcription with it. Absent on a word typed by
   *  hand — nobody types IPA — and the card simply shows none. */
  ipa?: string;
  note?: string;
  /** The lesson label it was pasted in under. */
  lesson?: string;
  source?: 'catalogue' | 'app';
  addedAt?: Millis;
  updatedAt?: Millis;
  /** A tombstone, so a deletion travels instead of being resurrected. */
  deleted?: boolean;
}

/** What the pipeline says about the catalogue it built: `meta.json`. */
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

/** One row of the shipped index: enough to rank and to search, no more. */
export interface IndexEntry {
  k: WordKey;
  fr: string;
  en: string[];
  /** Level file this word's full record lives in. */
  lvl: number;
  /** Share of running French text this word and its inflections account for. */
  m: number;
  /** How much the word looks like its English, 0..1. */
  looks?: number;
  /** How much it sounds like its English, 0..1. */
  sounds?: number;
  /** A function word — a preposition, a conjunction — which the ranking left
   *  out and the inventory put back. It has no similarity score, because
   *  "how much *sur* looks like *on*" is not a question, and it starts on the
   *  sense channel rather than the written one. */
  kind?: 'function';
}

export interface Example {
  /** The whole sentence. */
  fr: string;
  en: string;
  /** The form of the word as it appears in it. */
  f: string;
  /** Matched by context rather than by spelling alone. */
  ctx?: boolean;
}

export interface ConjugationRow {
  /** Pronoun. */
  p: string;
  /** Accepted variants of the same form: "je paye" or "je paie". */
  also?: string[];
  /** Stem, where the table shows one. */
  s: string;
  /** Ending. */
  e: string;
  /** The whole form. */
  f: string;
  /** An accepted variant, or a form identical to another in the table. */
  alt?: boolean;
  dup?: boolean;
}

export interface ConjugationGroup {
  id: string;
  mood: string;
  tense: string;
  stem: string;
  irregular: boolean;
  note: string;
  rows: ConjugationRow[];
  /** Other tenses with these same forms, named where the table says so. */
  shares?: string[];
}

export interface CompoundTense {
  id: string;
  label: string;
  aux: string;
  aux_key: string;
  aux_form: string;
  participle: string;
  example: string;
  why: string;
  agrees: boolean;
}

export interface Conjugation {
  lemma: string;
  aux: string;
  shape: string;
  groups: ConjugationGroup[];
  compound: CompoundTense[];
  impersonal: { label: string; form: string; hint?: string }[];
  links: string[];
  examples: Record<string, Example[]>;
}

/** A word as a card shows it: the catalogue's record, your corrections on top,
 *  or a record of your own turned into the same shape. */
export interface StudyWord {
  k: WordKey;
  /** As shown and as typed: "le fait", article and all. */
  fr: string;
  en: string[];
  /** What an answer is graded against. The same as `fr` for every word the
   *  catalogue ships; kept separate because a correction changes both. */
  answer: string;
  lemma: string;
  pos: string;
  lvl: number;
  gender?: Gender;
  number?: GrammaticalNumber;
  ipa?: string;
  m?: number;
  mass?: number;
  rank?: number;
  looks?: number;
  sounds?: number;
  /** Media file names under /media, or null where there is none. */
  audio?: string | null;
  native?: string | null;
  cue?: string;
  cue_audio?: string | null;
  note?: string;
  def?: { fr?: string[]; en?: string[] };
  ex?: Example[];
  conj?: Conjugation;
  /** See IndexEntry.kind. */
  kind?: 'function';
  /** A function word's core sense, in one line of English: the picture its
   *  other senses grow out of. Written by hand in the pipeline's inventory. */
  sense?: string;
  /** How soon a function word joins the queue; see frcog/function.py. */
  stage?: number;
  /** The words this one is chosen against on a choose card, by key. Every one
   *  is an inventory word with a card of its own, which is what keeps the
   *  right answer spread evenly over the set. */
  contrast?: WordKey[];
  /** The prepositions the word governs — "penser à", "avoir besoin de" —
   *  each with its English, written by hand in the pipeline (frcog/function.py).
   *  *à* and *de* mean nothing on their own, so they are not taught as words:
   *  they ride on the word that decides them, shown on the back of its cards. */
  chunks?: { fr: string; en: string }[];
  /** Yours rather than the catalogue's: its audio is made on the device. */
  user?: boolean;
  /** Fields it still needs before it can be asked. */
  missing?: string[];
}

/* ------------------------------------------------------- clips, lessons -- */

/** Audio made on this device for a word the catalogue has none for. Never
 *  synced: each device makes its own, the model being local. */
export interface Clip {
  /** "<key>|<fr or en>|<engine>". */
  id: string;
  key: string;
  kind: 'fr' | 'en';
  engine: string;
  /** Exactly what was said, so a clip can tell it has been outgrown. */
  text: string;
  blob: Blob;
  /** How long the worker took, and how long the audio runs. */
  genMs?: number;
  audioMs?: number;
  backend?: string | null;
  createdAt?: Millis;
  /** When it was last handed to the player, which is what the cap on the
   *  audio cache evicts by. Absent on a row from before the cap existed and
   *  on one never played, both of which the cap counts as older than any
   *  that was: the next to go. */
  lastUsed?: Millis;
}

export interface Lesson {
  id: string;
  label: string;
  keys: WordKey[];
  addedAt: Millis;
  updatedAt: Millis;
}

/* ------------------------------------------------------------- settings -- */

export type TransferPolicy = 'off' | 'unmetered' | 'always';
export type GenderMark = 'none' | 'letter';
export type GenderPattern = 'none' | 'underline';
export type PluralStyle = 'plural' | 'gender' | 'both';

/** The cues a word is drawn with. Every screen that shows a French word reads
 *  these, which is why they are their own record rather than loose settings. */
export interface DisplaySettings {
  /** Colour the article at all. */
  genderColour: boolean;
  /** The "(f)" beside the word. */
  genderMark: GenderMark;
  /** A shape cue under the article, for a red/green eye or a greyscale print. */
  genderPattern: GenderPattern;
  /** Empty means the theme's own colour. */
  colourMasc: string;
  colourFem: string;
  colourPlur: string;
  /** The colour of an article that stands for either gender, "l'ami". */
  colourBoth: string;
  /** Which cue wins on a word taught in the plural. */
  pluralStyle: PluralStyle;
}

/** Every dial, in one record. The store holds one row per name; `getSettings`
 *  lays what is stored over the defaults, so the study dials are always
 *  present and the rest are absent until something writes them. */
export interface Settings extends Partial<DisplaySettings> {
  /* What a day should look like. */
  /** Minutes of answering set aside for each weekday, Monday first. The day's
   *  size in cards is these over the pace your answers have been taking; the
   *  catalogue's new words come from the room that leaves after what is due,
   *  and stop once the minutes are spent. Zero is a day off. */
  minutesByWeekday: number[];
  /** No longer read: the day is minutes now (plan.ts). Kept so a row stored
   *  before that has a field to land in. */
  targetReviews?: number;
  maxNewPerDay: number;
  desiredRetention: number;
  refresherShare: number;
  costPerNewWord: number;
  leechThreshold: number;
  sessionLimit: number;
  /** One new card — your own words first — every this many cards of a
   *  sitting: the exploration share, a fixed slice of every sitting spent
   *  finding out what you know of a word you have not met. Two at the least;
   *  a sitting of nothing but new words is a lesson, not a sitting. */
  exploreEvery: number;
  /* What may happen without being asked. */
  autoSync: TransferPolicy;
  autoSyncMinutes: number;
  bulkDownload: TransferPolicy;
  bulkConsent: boolean;
  /* How words are painted: DisplaySettings, each dial absent until set. */
  /* Where this device syncs to. */
  syncApi?: string;
  syncToken?: string;
  syncCursor?: number;
  syncedAt?: Millis;
  syncEmail?: string;
  /** When the voice makes a clip nothing has asked for yet. True, or absent:
   *  ahead of time — everything the sitting's cards will say, in the order
   *  the cards come, so the flip plays at once; and the forms of a verb whose
   *  table is opened. False: on demand, each clip the first time a card or a
   *  hover wants it, a second or so of waiting and no work the device was not
   *  asked for. Either way nothing is made until the voice is on the device. */
  eagerVoice?: boolean;
  /** Keep the clips made on this device under `clipCacheMb`, dropping the
   *  ones not heard for longest (clipcache.ts). Off, they accumulate: a few
   *  hundred kilobytes a sentence, which on a phone adds up over a year. */
  capClips: boolean;
  /** The cap, in megabytes. Read only while `capClips` is on, so turning the
   *  cap off and on again keeps the number. */
  clipCacheMb: number;
  /* What the on-device voice cost here. */
  supertonicReady?: boolean;
  supertonicLoadMs?: number;
  supertonicBackend?: string;
}

/** A settings value as it comes back out of the store, before it is trusted. */
export type SettingValue = Settings[keyof Settings];
