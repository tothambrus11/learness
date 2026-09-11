/** The shapes everything else agrees on.
 *
 *  Three kinds of data meet in this app and they are easy to confuse, so they
 *  are named apart here and nowhere else:
 *
 *  * The **catalogue** is shipped, read-only and versioned — what the pipeline
 *    built. It is fetched as JSON and never written.
 *  * What the **learner owns** — cards, the review log, words added by hand —
 *    lives in IndexedDB, syncs between devices, and is the only thing that can
 *    be lost.
 *  * A **study word** is the two of them resolved together: a catalogue record
 *    with the learner's corrections laid on top, or a hand-typed record alone.
 *    It exists only in memory, for the length of one screen.
 *
 *  Nothing here has behaviour. Modules that own a shape own its rules.
 */
import type { Card as FsrsCard, Grade, State } from 'ts-fsrs';

/* ------------------------------------------------------------ identity -- */

/** A word's identity: `"<lemma>|<pos>"`, as `wordKey()` in keys.ts builds it.
 *
 *  Stable across catalogue rebuilds, which is the whole point: progress hangs
 *  off this and never off a row id, so regenerating the catalogue cannot
 *  detach a word from its history. The lemma may itself contain a bar, so a
 *  key is split from the right.
 */
export type WordKey = string;

/** A card's identity: `"<word key>|<channel>|<rung>"`, as `cardId()` builds it.
 *
 *  One card per word per rung, because each rung tests a different memory and
 *  so needs its own interval.
 */
export type CardId = string;

/** The two ladders a word is climbed on, from `CHANNELS`. */
export type Channel = 'written' | 'heard';

/** Rungs of the written ladder, in the order they are climbed. */
export type WrittenRung = 'recognise' | 'say' | 'write' | 'use';

/** Rungs of the heard ladder, in the order they are climbed. */
export type HeardRung = 'hear' | 'dictate';

/** Any rung of either ladder. */
export type Rung = WrittenRung | HeardRung;

/** The five directions cards were keyed by before the ladder existed.
 *
 *  Kept so old review rows still label themselves, and so a card arriving by
 *  sync from a device that has not migrated can be placed on the rung it
 *  implies. `speak` maps to nothing: it was graded by a recogniser that
 *  dropped the article, so those cards retire.
 */
export type LegacyDirection = 'fr_en' | 'en_fr' | 'audio_fr' | 'audio_en' | 'speak';

/** How a review row names the exercise it was: a rung as `"written/write"`,
 *  or one of the old direction names. Rows are never rewritten, so both
 *  spellings are read forever. */
export type ExerciseName = `${Channel}/${Rung}` | LegacyDirection;

/* ---------------------------------------------------------- what is owned -- */

/** One scheduled card: a rung of a word, with the memory model's state on it.
 *
 *  The FSRS fields (`due`, `stability`, `reps`, …) are owned by the scheduler
 *  and must only be changed by grading an answer. Everything below them is the
 *  app's own.
 *
 *  Invariants the rest of the code relies on:
 *  * `id` is always `cardId(key, channel, rung)` — never assigned by hand.
 *  * At most one card per (`key`, `channel`) has `retired === false`; the
 *    highest rung reached is the live one and `settleRungs()` enforces it.
 *  * `updatedAt` is the wall clock at the last local write. Sync compares it,
 *    so a write that forgets to set it will not travel.
 */
export interface Card extends FsrsCard {
  /** `cardId(key, channel, rung)`. The primary key in the `cards` store. */
  id: CardId;
  /** Which word this is a rung of. */
  key: WordKey;
  /** Which ladder the rung belongs to. */
  channel: Channel;
  /** Which rung of that ladder this card asks. */
  rung: Rung;
  /** True once a higher rung of the same channel exists. Derived by
   *  `settleRungs()` on every device, so it is never synced. A retired card
   *  is kept for its history and is never scheduled. */
  retired: boolean;
  /** Milliseconds at the last local write. The merge's tie-break, and what
   *  `collectPush()` filters on. Absent only on a card from before this
   *  field existed. */
  updatedAt?: number;
  /** Consecutive answers of Good or better on this rung. Two in a row climbs
   *  it. Reset to zero by anything below Good. */
  streak?: number;
  /** True once `lapses` reaches the leech threshold: the word keeps being
   *  forgotten and wants a different approach. Recomputed on every answer. */
  leech?: boolean;
  /** Set on a word the learner asked for rather than one the ranking reached:
   *  the lesson's label, or `true` for a word added without one. Such cards
   *  go to the front of the next sitting. */
  lesson?: string | true;
}

/** One answer, exactly as it was given. Appended, never updated.
 *
 *  The log is the only honest record of a day: a card holds the state it
 *  reached, but cannot say when the work was done, how long it took, or what
 *  was got wrong on the way. It is also what FSRS would retune its own
 *  parameters from, so rows are kept forever and merging is a set union.
 */
export interface Review {
  /** Unique across every device: the row's identity when two devices merge.
   *  Minted with `crypto.randomUUID()` at the moment of the answer. */
  uid: string;
  /** IndexedDB's own auto-increment key. Local, meaningless anywhere else,
   *  and stripped before a row is pushed. */
  i?: number;
  /** The card answered. */
  id: CardId;
  /** The word answered, so the log can be read without the cards. */
  key: WordKey;
  /** The ladder the rung belonged to. Absent on rows from before the ladder. */
  channel?: Channel;
  /** The rung answered. Absent on rows from before the ladder. */
  rung?: Rung;
  /** What the exercise was called, in whichever spelling was current. */
  direction: ExerciseName;
  /** Unix **seconds**, not milliseconds. The log is the one place that uses
   *  seconds, because it is the format the pipeline's database expects. */
  ts: number;
  /** What was pressed, on the FSRS 1-4 scale. */
  rating: Grade;
  /** Milliseconds spent on the card, or null where it was not measured. */
  ms: number | null;
  /** The card's state *before* this answer, which is what makes a row a
   *  memory test or a first exposure. */
  state: State;
  /** True when this answer was the one that made the word count as known.
   *  Written down because it cannot be recovered later: it depends on the
   *  card as it was a moment earlier. */
  learned?: boolean;
  /** The rung this answer climbed to, or null if it climbed nothing. */
  promoted?: Rung | null;
  /** Said aloud and it came out wrong. A flag beside the grade, never part of
   *  it: pronunciation is a different memory and must not shorten the
   *  interval of the one the card tests. */
  mispronounced?: boolean;
  /** True once this row has been accepted by the server, so the next push
   *  need not carry it again. Local only; never sent. */
  synced?: boolean;
}

/** A word the learner added: from a tutor, a menu, a sign in the street.
 *
 *  Two kinds share this shape. A word the catalogue already has is *promoted*
 *  and stores the catalogue's own key, so the recordings and verb tables come
 *  with it. A word the catalogue lacks is studied from what was typed here.
 *
 *  Deletion is a tombstone rather than a removal, so that it travels to the
 *  other devices instead of being resurrected by them.
 */
export interface UserWord {
  /** The word's identity, and the primary key of the `words` store. */
  k: WordKey;
  /** The French as typed, or the catalogue's spelling for a promoted word. */
  fr: string;
  /** Translations, best first. May be empty: a word without one is saveable
   *  and flagged, because half a word written down beats one forgotten. */
  en: string[];
  /** `noun` | `verb` | `adj` | `adv` | `phrase` | `other` | `unknown`. */
  pos: string;
  /** `m` | `f` | `mf` | `''`. Only meaningful on a noun. */
  gender?: string;
  /** `pl` when the plural is the form worth teaching ("les gens"), else `''`. */
  number?: string;
  /** Whatever the learner wants to remember about it. */
  note?: string;
  /** The lesson this arrived with, for grouping. `''` when added alone. */
  lesson?: string;
  /** Where the record came from: the catalogue, this app, or the MCP server. */
  source?: 'catalogue' | 'app' | 'mcp';
  /** Milliseconds when the word was first added. Survives a re-add. */
  addedAt?: number;
  /** Milliseconds at the last edit. Last write wins when two devices merge. */
  updatedAt?: number;
  /** A tombstone. The row stays so the deletion can travel. */
  deleted?: boolean;
}

/** A pasted lesson: the words that arrived together, kept so they can be
 *  reviewed as a group. */
export interface Lesson {
  /** A UUID, or IndexedDB's auto-increment key on the oldest rows. */
  id: string | number;
  /** What the learner called it. May be empty. */
  label: string;
  /** Milliseconds when the lesson was pasted. */
  addedAt: number;
  /** Milliseconds at the last edit; the merge's tie-break. */
  updatedAt?: number;
  /** The words it introduced. */
  keys: WordKey[];
}

/** Audio made on this device for a word the catalogue has no recording of.
 *
 *  Never synced: the model is local, so every device makes its own, and the
 *  blobs are far larger than everything else put together.
 */
export interface Clip {
  /** `"<key>|<kind>|<engine>"`, as `clipId()` builds it. The voice is in the
   *  id so that changing voices does not mean guessing which model made what. */
  id: string;
  /** The word it says. For a sentence clip this is `"<word key>#ex<n>"`. */
  key: string;
  /** Which side of the card it says. */
  kind: 'fr' | 'en';
  /** The voice that made it. */
  engine: string;
  /** Exactly what was spoken. A clip whose text no longer matches the word is
   *  out of date, and nothing plays it until it is made again. */
  text: string;
  /** The audio itself. */
  blob: Blob;
  /** Milliseconds the worker spent making it, for the voice comparison. */
  genMs?: number;
  /** Milliseconds of audio produced, so a real-time factor can be worked out. */
  audioMs?: number;
  /** Which ONNX backend ran it: `webgpu`, `wasm`. */
  backend?: string | null;
  /** Milliseconds when it was made. */
  createdAt: number;
}

/* --------------------------------------------------------- the catalogue -- */

/** One example sentence, as the pipeline found it in Tatoeba. */
export interface Example {
  /** The sentence in French. */
  fr: string;
  /** Its English translation. */
  en: string;
  /** The form of the word as it stands in the sentence — "sont", not "être".
   *  This is what a "use it" card accepts. */
  f: string;
  /** True when the form was matched by context rather than spelling alone. */
  ctx?: boolean;
}

/** One person of one tense in a verb table. */
export interface ConjugationRow {
  /** The pronoun: "je", "j'", "tu", "il", "nous", "vous", "ils". */
  p: string;
  /** The stem, where the table splits the form; `''` for an irregular one. */
  s: string;
  /** The ending, matching the stem. */
  e: string;
  /** The whole form, stem and ending joined. This is what is read. */
  f: string;
  /** True where this form is one of several accepted for the person. */
  alt: boolean;
  /** True where this form is spelt the same as another in the same table. */
  dup: boolean;
  /** Other forms accepted for this person ("assieds" beside "assois"), or
   *  absent where there is only one. */
  also?: string[];
}

/** One tense of a verb: a mood, a name and its persons. */
export interface ConjugationGroup {
  /** The group's id: `pres`, `imp`, `fut`, `cond`, `subj`, `imper`, `hist`,
   *  `subjimp`. Example sentences are filed under these. */
  id: string;
  /** The mood in French: "Indicatif", "Subjonctif". */
  mood: string;
  /** The tense in French: "Présent", "Imparfait". */
  tense: string;
  /** The stem the whole group is built on, or `''` when it is irregular. */
  stem: string;
  /** True where the forms cannot be derived from the stem. */
  irregular: boolean;
  /** Anything worth saying about the tense, or `''`. */
  note: string;
  /** The persons, in the usual order. A row can be null: the imperative has a
   *  form for three persons out of six, and the gaps are kept so the grid
   *  still lines up with the tenses beside it. */
  rows: (ConjugationRow | null)[];
  /** Ids of other groups whose forms are identical to this one's, so the
   *  table can say so instead of printing them twice. */
  shares?: string[];
}

/** One of the forms a verb has outside the six persons: the infinitive, the
 *  present participle, the past participle. */
export interface Impersonal {
  /** What it is called, in French: "Participe passé". */
  label: string;
  /** The form itself. */
  form: string;
  /** How it is met in a sentence, where that is worth a word: "en mettant".
   *  Absent on most. */
  hint?: string;
}

/** One compound tense, worked out from an auxiliary and the participle rather
 *  than listed person by person — the table would be six rows of the same two
 *  words. */
export interface CompoundTense {
  /** The tense's id, which is what the example sentences are filed under:
   *  `pc`, `pqp`, `futan`. */
  id: string;
  /** The tense in French: "Passé composé". */
  label: string;
  /** Which auxiliary it takes: "avoir" or "être". */
  aux: string;
  /** The simple tense the auxiliary is put into, as a group id: `pres` for the
   *  passé composé, `imp` for the plus-que-parfait. */
  aux_key: string;
  /** The auxiliary in that tense, first person: "ai", "avais". */
  aux_form: string;
  /** The past participle. */
  participle: string;
  /** The whole thing said once, first person: "j'ai mis". */
  example: string;
  /** What the tense is for, in English, in a few words. */
  why: string;
  /** True where the participle agrees, which is what the note beside the
   *  auxiliary warns about. */
  agrees: boolean;
}

/** A verb's table as the catalogue ships it. */
export interface Conjugation {
  /** The infinitive. */
  lemma: string;
  /** The auxiliary the compound tenses take: "avoir" or "être". */
  aux: string;
  /** One entry per tense. */
  groups: ConjugationGroup[];
  /** Example sentences by group id, including compound ids such as `pc`. */
  examples?: Record<string, Example[]>;
  /** What kind of verb it is, in a few words: "irregular -re". */
  shape?: string;
  /** The infinitive and the two participles. */
  impersonal?: Impersonal[];
  /** The compound tenses, behind their own toggle. */
  compound?: CompoundTense[];
  /** Notes about which stems are shared, as sentences with `<b>` in them —
   *  which is why they are rendered as HTML. Written by the pipeline, never by
   *  a learner. */
  links?: string[];
}

/** What a word means, in both languages, as the sources give it. */
export interface Definitions {
  /** French definitions — a sentence of French about a word just met is the
   *  cheapest reading in the deck. */
  fr?: string[];
  /** The English side is a list of senses, not definitions: English Wiktionary
   *  glosses a French word rather than defining it. */
  en?: string[];
}

/** One row of the shipped index, which covers every word in a small file.
 *
 *  The index is in ranked order, so taking from the front is taking the
 *  easiest useful words that have not been started. It carries just enough to
 *  search and to schedule; the rest arrives one level at a time.
 */
export interface CatalogueEntry {
  /** The word's identity. */
  k: WordKey;
  /** The French as it is shown, article and all: "la source". */
  fr: string;
  /** Translations, best first. */
  en: string[];
  /** Which level of 100 words it falls in; 1 is the commonest. */
  lvl: number;
  /** Its share of running French text, inflections included, as 0..1. Summing
   *  this over the words known is the headline number. */
  m: number;
  /** How much the spelling resembles the English, 0..1. At or above
   *  `LOOKS_FREE` the word reads as English on sight. */
  looks?: number;
  /** How much the pronunciation resembles the English, 0..1. At or above
   *  `SOUNDS_FREE` the heard ladder skips listening for meaning. */
  sounds?: number;
}

/** A full catalogue record, as a level file ships it: the index row plus
 *  everything a card needs to be asked. */
export interface CatalogueWord extends CatalogueEntry {
  /** The word without its article, for matching what was typed. */
  lemma: string;
  /** What a "write it" card accepts, which is the shown form. */
  answer: string;
  /** `noun` | `verb` | `adj` | `adv` | `phrase`. */
  pos: string;
  /** `m` | `f` | `mf` | `''`. */
  gender: string;
  /** The pronunciation, in IPA. */
  ipa: string;
  /** Its place in the ranking, 1 first. */
  rank?: number;
  /** The unrounded frequency mass; `m` is the rounded one that is summed. */
  mass?: number;
  /** The synthesised French prompt, as a file under `/media`. */
  audio?: string | null;
  /** A human recording where one was found, as a file under `/media`. */
  native?: string | null;
  /** The English cue, which is the first sense shortened. */
  cue?: string;
  /** The cue spoken, as a file under `/media`. */
  cue_audio?: string | null;
  /** Sentences the word can be met in. The "use it" rung needs one. */
  ex?: Example[];
  /** What it means, in both languages. */
  def?: Definitions;
  /** The verb table, on a verb. */
  conj?: Conjugation;
  /** True for a Helvetism: "natel", "septante". Flagged on the card, since
   *  this deck is built for a learner living in Valais. */
  swiss?: boolean;
}

/** The catalogue's own header: what was built, and how far it reaches. */
export interface CatalogueMeta {
  /** The format version of the export. */
  v: number;
  /** Unix seconds when the pipeline ran. */
  generated: number;
  /** Words per level. */
  levelSize: number;
  /** Every level number that exists. */
  levels: number[];
  /** How many words the catalogue holds. */
  words: number;
  /** How many of them are verbs with a table. */
  verbs: number;
  /** The share of running French text the whole catalogue reaches, 0..1 —
   *  the ceiling the headline number is climbing towards. */
  ceiling: number;
  /** The exercise names the export was built for. Historical. */
  directions?: string[];
  /** The attribution line the example sentences carry. */
  examples?: string;
}

/* ------------------------------------------------------------ study word -- */

/** A word resolved for a screen: the catalogue's record with the learner's
 *  corrections laid on top, or a hand-typed record on its own.
 *
 *  This is what every card renders from. It exists only in memory and is
 *  rebuilt on every load, which is why correcting a translation shows on the
 *  very next card rather than the next sitting.
 */
export interface StudyWord extends Partial<CatalogueWord> {
  /** The word's identity. Always present. */
  k: WordKey;
  /** The French as shown, article and all. Always present. */
  fr: string;
  /** Translations, best first. Always present, possibly empty. */
  en: string[];
  /** `pl` when the word is taught in the plural. */
  number?: string;
  /** Anything the learner wrote about it. */
  note?: string;
  /** True when this came from the learner's own list rather than the
   *  catalogue: the screens offer to record it, and to correct it. */
  user?: boolean;
  /** Which required fields are still blank, from `missingFields()`. A card
   *  with no English cannot be asked, and says so rather than showing blank. */
  missing?: string[];
}

/** One card of a sitting, with the word it is about already resolved. */
export interface SittingItem {
  /** The card being asked. */
  card: Card;
  /** The word it is a rung of, looked up at load time. */
  word: StudyWord;
}

/* --------------------------------------------------------------- grading -- */

/** How close a typed answer was.
 *
 *  `accent` and `article` are deliberately not failures: the point is recall,
 *  not transcription, and both are told apart from `ok` only so the card can
 *  say which one to mind.
 */
export type Verdict = 'ok' | 'accent' | 'article' | 'close' | 'no';

/** What a check returns. An object rather than the bare verdict, so a reason
 *  can be added later without every caller changing. */
export interface CheckResult {
  /** How close it was. */
  verdict: Verdict;
}

/* -------------------------------------------------------------- settings -- */

/** How much work a day should hold, and how the scheduler should behave. */
export interface StudySettings {
  /** The real budget: reviews per day the learner is happy to do. New words
   *  are whatever capacity this leaves. */
  targetReviews: number;
  /** The ceiling on new words, even on an empty day. */
  maxNewPerDay: number;
  /** The FSRS dial: how much the learner is willing to forget, 0..1. */
  desiredRetention: number;
  /** The slice of a sitting spent on old words that are not due yet, 0..1. */
  refresherShare: number;
  /** Same-day reviews one new word is assumed to generate. */
  costPerNewWord: number;
  /** Lapses before a card is flagged as a leech. */
  leechThreshold: number;
  /** Cards offered in one sitting. */
  sessionLimit: number;
}

/** When the app may spend the network on its own. */
export interface TransferSettings {
  /** Sync: `off` | `unmetered` | `always`. Small, so it defaults to always. */
  autoSync: TransferPolicy;
  /** Never sync automatically more often than this many minutes. */
  autoSyncMinutes: number;
  /** Audio: `off` | `unmetered` | `always`. Megabytes, so it is gated. */
  bulkDownload: TransferPolicy;
  /** "Yes, download on this connection", remembered per device. */
  bulkConsent: boolean;
}

/** The three answers to "may the app spend the network now". */
export type TransferPolicy = 'off' | 'unmetered' | 'always';

/** How a word's gender is shown. Colour alone fails two ways — a red/green
 *  pair is the commonest colour blindness there is, and a colour learned here
 *  means nothing in a book — so there are three cues, each switchable. */
export interface DisplaySettings {
  /** Colour the article at all. */
  genderColour: boolean;
  /** The plain letter beside the word: `none` | `letter`. */
  genderMark: 'none' | 'letter';
  /** A shape cue under the article: `none` | `underline`. */
  genderPattern: 'none' | 'underline';
  /** The learner's own masculine colour; `''` means the theme's. */
  colourMasc: string;
  /** The learner's own feminine colour; `''` means the theme's. */
  colourFem: string;
  /** The learner's own plural colour; `''` means the theme's. */
  colourPlur: string;
  /** How a word taught in the plural is painted, since it still has a
   *  gender: `plural` | `gender` | `both`. */
  pluralStyle: 'plural' | 'gender' | 'both';
}

/** What this device knows about syncing. Written by signing in, and by every
 *  successful round trip. */
export interface SyncSettings {
  /** Where the API is. Empty means the origin the app is served from. */
  syncApi: string;
  /** This device's bearer token. Empty means not signed in. */
  syncToken: string;
  /** The server sequence this device has everything up to. */
  syncCursor: number;
  /** Milliseconds at the start of the last successful sync. */
  syncedAt: number;
  /** The account's email, for the settings screen to show. */
  syncEmail: string;
}

/** What the on-device voice left behind, so the settings screen can report
 *  it without loading the model. */
export interface VoiceSettings {
  /** True once the model has been fetched on this device. */
  supertonicReady: boolean;
  /** Milliseconds the one-time load took. */
  supertonicLoadMs: number | null;
  /** Which ONNX backend ran it. */
  supertonicBackend: string | null;
}

/** Everything in the `settings` store, as `getSettings()` hands it back:
 *  the defaults with whatever has been written over them. */
export type Settings = StudySettings &
  TransferSettings &
  DisplaySettings &
  SyncSettings &
  VoiceSettings;

/* ------------------------------------------------------------------ sync -- */

/** What this device has that the server has not seen.
 *
 *  Cards, words and lessons are filtered on `updatedAt`; reviews on their own
 *  `synced` flag, because the log is append-only and a row is either sent or
 *  it is not.
 */
export interface SyncPush {
  /** Cards changed since the last sync. */
  cards: Card[];
  /** Words changed since the last sync, tombstones included. */
  words: UserWord[];
  /** Reviews never yet accepted by the server. */
  reviews: Review[];
  /** Lessons changed since the last sync. */
  lessons: Lesson[];
}

/** What the server sends back: everything past the device's cursor, one page
 *  of each table at a time. */
export interface SyncPull {
  /** Cards from the other devices. May carry the pre-ladder shape. */
  cards?: Card[];
  /** Words from the other devices, tombstones included. */
  words?: UserWord[];
  /** Review rows this device has not got. */
  reviews?: Review[];
  /** Lessons from the other devices. */
  lessons?: Lesson[];
}

/** One round trip's answer. */
export interface SyncResponse {
  /** The sequence the device now has everything up to. It stops short of a
   *  page that filled, so nothing is skipped. */
  cursor: number;
  /** True when a table filled its page and there is more behind it. The
   *  device comes straight back rather than waiting for the next sync. */
  more?: boolean;
  /** How many rows of each table the push wrote. */
  pushed?: Record<string, number>;
  /** The rows themselves. */
  pull?: SyncPull;
}

/** How many rows of each kind a merge brought in. Shown verbatim, so "12
 *  words and 340 reviews came in" can be said rather than just "synced". */
export interface MergeCounts {
  /** Cards whose state the pull advanced. */
  cards: number;
  /** Words the pull added or changed. */
  words: number;
  /** Review rows the pull added. */
  reviews: number;
}

/* ----------------------------------------------------------- the sitting -- */

/** A sitting written down, so a reload deals the same card.
 *
 *  Device-local and disposable: it is a position in a queue, not something
 *  learned. It is rebuilt from the cards whenever it does not apply.
 */
export interface SittingSnapshot {
  /** The queue, as card ids. Ids rather than words, so the word behind one is
   *  looked up again on every load. */
  ids: CardId[];
  /** How far through the queue the learner is. */
  i: number;
  /** Local midnight of the day it was dealt. A sitting does not survive the
   *  day turning over: yesterday's due pile is not today's. */
  day: number;
  /** The running tally the "session done" panel reports. */
  done: SittingTally;
  /** What was answered so far, so looking back survives a reload. */
  history: SittingHistoryRow[];
  /** Milliseconds when it was last written. A queue nobody started goes stale. */
  at: number;
  /** Set by the walking mode that no longer exists. A snapshot carrying it
   *  was dealt without the typed rungs and is never resumed. */
  walk?: boolean;
}

/** What a sitting has achieved so far. */
export interface SittingTally {
  /** Cards answered, an "Again" counting each time it comes round. */
  answered: number;
  /** Of those, answered Good or better. */
  right: number;
  /** Words that crossed into "known" during the sitting. */
  learned: number;
  /** Rungs climbed. */
  promoted: number;
  /** Words whose heard ladder opened. */
  heard: number;
}

/** One answered card, as the snapshot stores it. */
export interface SittingHistoryRow {
  /** Which card was answered. */
  id: CardId;
  /** What was pressed. */
  rating: Grade;
  /** What was typed, where the rung takes typing. */
  typed?: string;
  /** How the typing was graded. */
  verdict?: CheckResult | null;
}

/** One answered card, resolved back onto the item it was about. */
export interface SittingHistoryEntry {
  /** The card and its word. */
  item: SittingItem;
  /** What was pressed. */
  rating: Grade;
  /** What was typed. */
  typed: string;
  /** How the typing was graded. */
  verdict: CheckResult | null;
}
