/** The names everything is filed under.
 *
 *  Identity first: a word's key and a card's id are built here and nowhere
 *  else, so the one rule that matters — progress hangs off a spelling, never
 *  off a row id — is enforced in one place. Then the ladders themselves, and
 *  the thresholds that decide where a word joins them.
 */
import type { Channel, HeardRung, LegacyDirection, Rung, WordKey, WrittenRung } from './types';

/** A word's identity, stable across catalogue rebuilds.
 *
 *  Progress is keyed on this, never on a row id, so regenerating the catalogue
 *  can never detach a word from its history.
 */
export const wordKey = (lemma: string, pos: string): WordKey => `${lemma}|${pos}`;

/** Two channels, each a ladder of rungs.
 *
 *  A word gets one scheduled card per channel, and the card's exercise gets
 *  harder as the word gets stronger: the ladder is climbed, not drilled in
 *  parallel. The written channel goes from recognising the word to producing
 *  it; the heard channel from catching its meaning by ear to writing down what
 *  was said. Listening is a channel of its own because for most of this deck
 *  the two diverge — "la nation" reads as English and sounds nothing like it —
 *  and one card cannot carry two intervals.
 */
export const CHANNELS = ['written', 'heard'] as const satisfies readonly Channel[];

/** Each channel's rungs, in the order they are climbed. Position in this list
 *  is the rung's rank: everything about climbing compares indices into it. */
export const RUNGS = {
  written: ['recognise', 'say', 'write', 'use'],
  heard: ['hear', 'dictate'],
} as const satisfies { written: readonly WrittenRung[]; heard: readonly HeardRung[] };

/** What a channel is called on screen. */
export const CHANNEL_LABEL: Record<Channel, string> = {
  written: 'Written',
  heard: 'Heard',
};

/** What each rung asks, in one phrase, for a list or a chip. */
export const RUNG_LABEL: Record<Rung, string> = {
  recognise: 'Read FR → EN',
  say: 'Say it, then check',
  write: 'Write it',
  use: 'Use it in a sentence',
  hear: 'Listen → meaning',
  dictate: 'Listen → write',
};

/** Rungs where the answer is typed and checked rather than self-judged. The
 *  study screen focuses an input for these and grades what was typed. */
export const TYPED: ReadonlySet<Rung> = new Set<Rung>(['write', 'dictate', 'use']);

/** Where a word enters each ladder is decided by how much it resembles its
 *  English — on the page, and out loud. Above these, the first rung would be
 *  a review passed at 100% before anything was studied.
 *
 *  `LOOKS_FREE` is spelling similarity: at or above it the word reads as
 *  English on sight, so the written ladder starts at "write it" instead.
 */
export const LOOKS_FREE = 0.75;

/** Pronunciation similarity, the heard ladder's equivalent of `LOOKS_FREE`:
 *  at or above it the word is recognised by ear already, so the ladder starts
 *  at dictation instead of listening for meaning. */
export const SOUNDS_FREE = 0.7;

/** Days of memory half-life at which a card counts as mature.
 *
 *  This is what "known" means everywhere in the app: the coverage number, the
 *  cards screen's label, and the ceiling that climbs a rung on its own.
 */
export const MATURE_STABILITY = 21;

/** Each rung is its own FSRS card, because a new rung tests a different
 *  memory and inherits an unknown share of the old one.
 *
 *  The key may itself contain a bar, so an id built here is only ever taken
 *  apart from the right — see `parseCardId()` in queue.ts.
 */
export const cardId = (key: WordKey, channel: Channel, rung: Rung): string =>
  `${key}|${channel}|${rung}`;

/** The five directions cards were keyed by before the ladder.
 *
 *  Kept so old review rows still label themselves, and so a card that arrives
 *  from a device that has not migrated can be placed on the rung it implies.
 */
export const DIRECTIONS = [
  'fr_en',
  'en_fr',
  'audio_fr',
  'audio_en',
  'speak',
] as const satisfies readonly LegacyDirection[];

/** What each of the old directions was called on screen. Read by review rows
 *  written before the ladder, which are never rewritten. */
export const DIRECTION_LABEL: Record<LegacyDirection, string> = {
  fr_en: 'Read FR→EN',
  en_fr: 'Recall EN→FR',
  audio_fr: 'Listen → write FR',
  audio_en: 'Listen → meaning',
  speak: 'Speak',
};

/** The rung each old direction becomes, or null where it becomes nothing.
 *
 *  `speak` maps to nothing on purpose: it was graded by a recogniser that
 *  dropped the article — which is the gender, which is what the card taught —
 *  so those cards retire and only their reviews survive.
 */
export const LEGACY_RUNG: Record<LegacyDirection, readonly [Channel, Rung] | null> = {
  fr_en: ['written', 'recognise'],
  en_fr: ['written', 'write'],
  audio_en: ['heard', 'hear'],
  audio_fr: ['heard', 'dictate'],
  speak: null,
};

/** The two label tables, widened to plain string keys.
 *
 *  A review row is never rewritten, so its `direction` is whatever spelling
 *  was current when it was written — including one a future version might add.
 *  Looking a row's own string up against a narrow key type would mean
 *  asserting it into one, which is exactly the lie this avoids.
 */
const LABEL_BY_DIRECTION: Record<string, string> = DIRECTION_LABEL;
const LABEL_BY_RUNG: Record<string, string> = RUNG_LABEL;

/** The label for whatever a review row says it was: a rung as
 *  `"written/write"`, or one of the old direction names. Falls back to the
 *  raw string, so a row from a future shape still prints as something.
 *
 *  Takes a plain string rather than `ExerciseName` for that reason: rows are
 *  never rewritten, so a name this version has never heard of has to print
 *  as itself rather than be refused.
 */
export function exerciseLabel(direction: string): string {
  const legacy = LABEL_BY_DIRECTION[direction];
  if (legacy) return legacy;
  const rung = direction.split('/')[1] ?? '';
  return LABEL_BY_RUNG[rung] ?? direction;
}
