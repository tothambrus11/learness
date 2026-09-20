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
import type { ThemeChoice } from './theme.js';
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
  /** What the catalogue was made from: one hash over the recipe of every
   *  pipeline stage — its code, its dumps, its package versions — as
   *  `data/recipe.json` records them. It stands where a timestamp used to,
   *  so the same data exports to the same bytes and a regeneration can find
   *  it has nothing to do. Empty when the pipeline never recorded one; the
   *  app shows nothing from it either way. */
  recipe: string;
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
  dictionary?: {
    letters: string[];
    words: number;
    /** The letters that have a file of verb tables, `dict-conj-<letter>`:
     *  a verb added from the dictionary has its forms like one from the
     *  curriculum (#91), fetched only when such a verb is opened. Absent
     *  from a catalogue built before the tables were shipped. */
    tables?: string[];
  };
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
  /** The corpus's own id for the sentence (Tatoeba), so a sentence is the
   *  same sentence across a rebuild of the catalogue: what a learner's
   *  history of it is kept by. Absent on a catalogue from before it was
   *  carried, and then the sentence is known by its text alone. */
  id?: number;
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

/* ----------------------------------------------------------------- bits -- */

/** The shape of a bit record as this version writes it. Bumped when a field
 *  changes meaning, and the change written here:
 *
 *  1 — id, openedAt, updatedAt, deleted. */
export const BIT_V = 1;

/** A grammar bit the learner has committed to (GRAMMAR.md).
 *
 *  The learner's one act on a bit: opening it, from the Grammar screen, once
 *  they have read what it teaches. Nothing opens a bit for them — the app
 *  asked for the imparfait of a verb the second time its card came round,
 *  and that is the complaint this record answers — and everything else about
 *  a bit (whether it is passed, what is due) is derived from the attempts
 *  and never stored. The id is the rule's id from the inventory, `V.pc`,
 *  which is why it is the same on every device and across every version.
 *  Synced last-write-wins with a tombstone, like a word: closed here is
 *  closed there, and not reopened by the device that missed it. */
export interface BitState {
  id: string;
  openedAt: Millis;
  updatedAt: Millis;
  deleted?: boolean;
  /** The shape this record was written in (BIT_V). */
  v: number;
}

/* -------------------------------------------------------------- grammar -- */

/** The shape of a rule card as this version writes it (see BIT_V). 1 — the
 *  first shape. */
export const RULECARD_V = 1;
/** The shape of an attempt as this version writes it. 1 — the first shape. */
export const ATTEMPT_V = 1;

/** The two memories a rule can have: reading it (which time is this?) and
 *  writing or saying it. Two intervals, as a word's written and heard
 *  channels are two. */
export type RuleMode = 'recognise' | 'produce';

/** The FSRS state of one rule in one mode (GRAMMAR.md, "The records").
 *
 *  In a store of its own rather than in `cards`, because a `CardId` names a
 *  word and a rule is not one: `getCard(rule)` stays a compile error. Merged
 *  last-write-wins on the last answer, as a card is. A rule that is gone
 *  is retired, and the card and its history stay. */
export interface RuleCard extends Schedule {
  /** "<rule id>|<mode>": `V.pc|recognise`. */
  id: string;
  rule: string;
  mode: RuleMode;
  updatedAt?: Millis;
  streak?: number;
  retired?: boolean;
  v: number;
}

/** One answer part of an attempt, with what it observed. */
export interface AttemptPart {
  /** The answer key, as it was that day. */
  expected: string;
  /** What the learner wrote, tapped or judged. */
  got: string;
  ok: boolean;
  /** The rules and items this part is evidence about: a rule id, or an
   *  item ref `item:<word key>:<tense>:<person>`. A rule is observed only
   *  where a wrong application of it would have made the part wrong. */
  obs: { of: string; ok: boolean }[];
}

/** One grammar exercise answered, whole: the grammar's review, and the
 *  record everything else is rebuilt from (GRAMMAR.md, "The records").
 *
 *  It carries both the raw answer and the labels: the labels are what the
 *  day's grading used and cannot be taken back; the raw answer with its spec
 *  is what a better analyser can re-label later. It carries the answer key
 *  as it was, so a catalogue rebuild cannot make an old right answer wrong.
 *  `gen`, `face` and `spec` are strings and unknown: an attempt from a
 *  generator this version does not know is kept, synced and ignored. */
export interface Attempt {
  /** IndexedDB's own auto-increment key, device-local, stripped before a push. */
  i?: number;
  uid: string;
  /** When, in seconds — the log's unit, as reviews. */
  ts: Seconds;
  ms: number | null;
  gen: string;
  face: string;
  /** What the generator was given: `{ n: 281, dialect: 'ch' }`,
   *  `{ key: 'finir|verb', tense: 'imp' }`. */
  spec: unknown;
  /** The instance's identity for breadth: `number:281`, `table:finir|verb:imp`. */
  instance: string;
  parts: AttemptPart[];
  /** The grade each card actually received, by card id. */
  grades: Record<string, Rating>;
  v: number;
  /** The version of the generator's analyser that labelled it. */
  genv: number;
  /** Reserved by the sync for rows the server has seen. */
  synced?: boolean;
}

/* ------------------------------------------------------------- settings -- */

export type TransferPolicy = 'off' | 'unmetered' | 'always';

/** The pause between the lines of a tense read aloud (conjspeech.ts).
 *
 *  `fixed` is that many milliseconds, and zero — the default — is none: the
 *  next line starts the moment this one ends, which is how a tense is heard
 *  as one thing. `echo` is room to say the line back yourself: the pause
 *  after a line is as long as the line, or as long as the next one, whichever
 *  runs longer. A pause is counted from the end of the line, so time spent
 *  waiting for the next clip to be made is part of it, not added to it. */
export type FormGap = { mode: 'fixed'; ms: number } | { mode: 'echo' };
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

/** A part of a card, or of the word page, that folds away behind a chevron:
 *  the definitions on the back, and a verb's forms. */
export type Section = 'defs' | 'forms';

/** Every dial, in one record. The store holds one row per name; `getSettings`
 *  lays what is stored over the defaults, so the study dials are always
 *  present and the rest are absent until something writes them. */
export interface Settings extends Partial<DisplaySettings>, ThemeChoice {
  /* What a day should look like. */
  /** Minutes of answering set aside for each weekday, Monday first. The day's
   *  size in cards is these over the pace your answers have been taking; the
   *  catalogue's new words come from the room that leaves after what is due,
   *  and stop once the minutes are spent. Zero is a day off. */
  minutesByWeekday: number[];
  /** The hour of the local clock at which one day ends and the next begins,
   *  a whole number 0–23: three unless set, so a sitting at half past
   *  midnight is still the evening's — its answers on the evening's tally,
   *  its new words against the evening's allowance, its minutes in the
   *  evening's budget, and the streak untouched. Zero is midnight, where the
   *  day used to turn (#70). Every "today" reads this one number, through
   *  `dayStart` (progress.ts). */
  dayStartsAt: number;
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
  /** Which of a card's fold-away sections were open when the learner last
   *  touched them, by name; a section not named is as `OPEN_BY_DEFAULT`
   *  (sections.ts) has it. Kept across sittings and reloads because a section
   *  closed on one card and open again on the next reload was the thing
   *  being asked for every time (#64). */
  openSections?: Partial<Record<Section, boolean>>;
  /* Which theme this device paints with: ThemeChoice (theme.ts), each dial
     absent until set. The themes themselves are records of their own, synced
     with the rest of your data; the choice among them stays on the device. */
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
  /** How long a tense read aloud pauses between its lines: none by default.
   *  There was a pause once that nobody had set — the next line's clip being
   *  made in the silence after this one (#60) — and the learner asked for a
   *  pause they had: none, a fixed one, or the length of the line. */
  formGap: FormGap;
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
