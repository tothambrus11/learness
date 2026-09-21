/** What a word, a channel and a rung are called, and how a card is named.
 *
 *  Progress is keyed on a word's identity, never on a row id, so regenerating
 *  the catalogue can never detach a word from its history. The two ids in the
 *  app look alike — both are bar-separated strings — and mean different
 *  things, so they are different types: `getCard` takes a card id, `cardsFor`
 *  takes a word key, and handing one where the other belongs no longer
 *  compiles.
 */
import type { RuleMode } from './model.js';

declare const ID: unique symbol;

/** "lemma|pos" — one word of the catalogue, or one you added. */
export type WordKey = string & { readonly [ID]: 'word' };
/** "lemma|pos|channel|rung" — one rung of one channel of one word. */
export type CardId = string & { readonly [ID]: 'card' };

export const wordKey = (lemma: string, pos: string): WordKey => `${lemma}|${pos}` as WordKey;

/** A key read back from storage, the catalogue or the wire, where it is a
 *  string until someone says otherwise. The one place that claim is made. A
 *  card id is never trusted this way: it is taken apart by `parseCardId`,
 *  which refuses one that does not name a real channel and rung. */
export const trustWordKey = (key: string): WordKey => key as WordKey;

/** The key of a word you typed yourself: the spelling as typed, lower-cased,
 *  and the part of speech, "unknown" where none was given. A promoted
 *  catalogue word keeps the catalogue's key instead, so "le train" becomes
 *  `train|noun` and not `le train|noun` — which is what the first connector
 *  minted, and how one word came to be two cards, one of them mute. The app
 *  and the server both make keys here, so they cannot disagree. */
export const userKey = (fr: string, pos: string): WordKey =>
  trustWordKey(`${fr.trim().toLowerCase()}|${pos || 'unknown'}`);

/** The lemma out of a key: everything before the last bar. A lemma may itself
 *  contain no bar, but reading from the right costs nothing and never lies. */
export const lemmaOf = (key: WordKey): string => key.slice(0, key.lastIndexOf('|'));

/** Four channels, each a ladder of rungs.
 *
 *  A word gets one scheduled card per channel, and the card's exercise gets
 *  harder as the word gets stronger: the ladder is climbed, not drilled in
 *  parallel. The written channel goes from recognising the word to producing
 *  it; the heard channel from catching its meaning by ear to writing down what
 *  was said. Listening is a channel of its own because for most of this deck
 *  the two diverge — "la nation" reads as English and sounds nothing like it —
 *  and one card cannot carry two intervals.
 *
 *  The two other channels are for what a word-to-word card cannot teach. The
 *  sense channel is the whole ladder of a function word — *sur*, *dans*,
 *  *depuis* — which has no English to read it from and is only ever met in a
 *  sentence: meet it, choose it against the words it is confused with, then
 *  write it into the gap. The form channel is a verb's conjugation, opened
 *  once the verb itself is known: read a form and say which time it means,
 *  then say a form aloud from its pronoun and tense. One form card per verb,
 *  the tense chosen inside the card: a card per tense was six hundred verbs
 *  times six, which pinned the day's allowance at nothing.
 */
export const CHANNELS = ['written', 'heard', 'sense', 'form'] as const;
export type Channel = (typeof CHANNELS)[number];

export const WRITTEN_RUNGS = ['recognise', 'say', 'write', 'use'] as const;
export const HEARD_RUNGS = ['hear', 'dictate'] as const;
export const SENSE_RUNGS = ['meet', 'choose', 'fill'] as const;
export const FORM_RUNGS = ['tense', 'voice'] as const;
export type WrittenRung = (typeof WRITTEN_RUNGS)[number];
export type HeardRung = (typeof HEARD_RUNGS)[number];
export type SenseRung = (typeof SENSE_RUNGS)[number];
export type FormRung = (typeof FORM_RUNGS)[number];
export type Rung = WrittenRung | HeardRung | SenseRung | FormRung;

export const RUNGS: Record<Channel, readonly Rung[]> = {
  written: WRITTEN_RUNGS,
  heard: HEARD_RUNGS,
  sense: SENSE_RUNGS,
  form: FORM_RUNGS,
};
/** Every rung there is, in ladder order, for a test that walks them all. */
export const ALL_RUNGS: readonly Rung[] = CHANNELS.flatMap((c) => RUNGS[c]);

export const isChannel = (value: unknown): value is Channel =>
  typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
export const isRung = (value: unknown): value is Rung =>
  typeof value === 'string' && (ALL_RUNGS as readonly string[]).includes(value);

export const CHANNEL_LABEL: Record<Channel, string> = {
  written: 'Written', heard: 'Heard', sense: 'In a sentence', form: 'Forms',
};
export const RUNG_LABEL: Record<Rung, string> = {
  recognise: 'Read FR → EN',
  say: 'Say it, then check',
  write: 'Write it',
  use: 'Use it in a sentence',
  hear: 'Listen → meaning',
  dictate: 'Listen → write',
  meet: 'Meet the word',
  choose: 'Pick the word for the gap',
  fill: 'Write the word into the gap',
  tense: 'Read the form → which time?',
  voice: 'Say the form',
};

/** The channel a rung belongs to. */
export const channelOf = (rung: Rung): Channel =>
  CHANNELS.find((c) => (RUNGS[c] as readonly string[]).includes(rung)) ?? 'written';

/** Rungs where the answer is typed and checked rather than self-judged. */
export const TYPED: ReadonlySet<Rung> = new Set<Rung>(['write', 'dictate', 'use', 'fill']);
/** Rungs answered by tapping one of a few options. The first tap is the
 *  grade; a wrong one is taken away and the question asked again, so the
 *  card teaches as well as tests, but never mistakes the retry for recall. */
export const CHOSEN: ReadonlySet<Rung> = new Set<Rung>(['choose', 'tense']);
/** Rungs whose question is the French, played aloud. The ear has already had
 *  it, so the flip does not play it again over the answer. */
export const HEARD_FIRST: ReadonlySet<Rung> = new Set<Rung>(['hear', 'dictate']);
/** Rungs where the answer is produced from the English with no prompt to say
 *  it aloud, so the card asks — and the model it plays is what to compare. */
export const SAY_ALOUD: ReadonlySet<Rung> = new Set<Rung>(['write', 'use', 'fill']);
/** Rungs whose answer is a word from a closed set — a preposition among its
 *  neighbours, a form out of a table — where a letter is the whole
 *  difference: *sans* is not *dans*, *serai* is not *serais*, *où* is not
 *  *ou*. The typo tolerance that is right for "développement" would pass
 *  every one of those, so these are graded on the letter. */
export const STRICT: ReadonlySet<Rung> = new Set<Rung>(['fill']);
/** Rungs about a phrase rather than a word — a sentence, a line of a table —
 *  which the player says whole: the word on its own is not what was asked. */
export const PHRASED: ReadonlySet<Rung> = new Set<Rung>(['use', 'fill', 'choose', 'meet', 'tense', 'voice']);

/** Where a word enters each ladder is decided by how much it resembles its
 *  English — on the page, and out loud. Above these, the first rung would be
 *  a review passed at 100% before anything was studied. */
export const LOOKS_FREE = 0.75;
export const SOUNDS_FREE = 0.70;

/** Days of memory half-life at which a card counts as known. */
export const MATURE_STABILITY = 21;

/** A rule card's id: the rule and the mode, bar-separated, like a card's
 *  id is its parts. Named once so the scheduler, the router and the
 *  fixtures spell it the same way. */
export const ruleCardId = (rule: string, mode: RuleMode): string => `${rule}|${mode}`;

/** Each rung is its own FSRS card, because a new rung tests a different
 *  memory and inherits an unknown share of the old one. */
export const cardId = (key: WordKey, channel: Channel, rung: Rung): CardId =>
  `${key}|${channel}|${rung}` as CardId;

/* The five directions cards were keyed by before the ladder. Kept so old
   review rows still label themselves, and so a card that arrives from a
   device that has not migrated can be placed on the rung it implies. */
export const DIRECTIONS = ['fr_en', 'en_fr', 'audio_fr', 'audio_en', 'speak'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DIRECTION_LABEL: Record<Direction, string> = {
  fr_en: 'Read FR→EN',
  en_fr: 'Recall EN→FR',
  audio_fr: 'Listen → write FR',
  audio_en: 'Listen → meaning',
  speak: 'Speak',
};
export const LEGACY_RUNG: Record<Direction, readonly [Channel, Rung] | null> = {
  fr_en: ['written', 'recognise'],
  en_fr: ['written', 'write'],
  audio_en: ['heard', 'hear'],
  audio_fr: ['heard', 'dictate'],
  speak: null,       /* graded by a recogniser that dropped the article; retired */
};

/** The label for whatever a review row says it was: a rung, or an old
 *  direction. Rows are historical data and may say anything, so this takes a
 *  string and is total. */
export function exerciseLabel(direction: string): string {
  const known = DIRECTION_LABEL[direction as Direction];
  if (known) return known;
  const rung = (direction || '').split('/')[1];
  return (rung && RUNG_LABEL[rung as Rung]) || direction;
}
