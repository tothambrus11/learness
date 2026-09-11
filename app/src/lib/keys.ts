/** The names everything is filed under: a word's key and a card's id, the two
 *  ladders they hang off, and the thresholds that decide where a word joins
 *  them. Keys and ids are built here and nowhere else. */
import type { Channel, HeardRung, LegacyDirection, Rung, WordKey, WrittenRung } from './types';

/** A word's identity, `"<lemma>|<pos>"`. Stable across catalogue rebuilds. */
export const wordKey = (lemma: string, pos: string): WordKey => `${lemma}|${pos}`;

/** The two channels, each a ladder of rungs: the written one runs from
 *  recognising a word to producing it, the heard one from catching its meaning
 *  by ear to writing down what was said. */
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

/** Spelling similarity, 0..1. At or above it a word reads as English on sight,
 *  so its written ladder starts at "write it". */
export const LOOKS_FREE = 0.75;

/** Pronunciation similarity, 0..1. At or above it a word is recognised by ear
 *  already, so its heard ladder starts at dictation rather than listening for
 *  meaning. */
export const SOUNDS_FREE = 0.7;

/** Days of memory half-life at which a card counts as mature. This is what
 *  "known" means everywhere in the app: the coverage number, the cards
 *  screen's label, and the ceiling that climbs a rung on its own. */
export const MATURE_STABILITY = 21;

/** A card's identity: `"<key>|<channel>|<rung>"`. The key may itself contain a
 *  bar, so an id built here is only ever taken apart from the right — see
 *  `parseCardId()` in queue.ts. */
export const cardId = (key: WordKey, channel: Channel, rung: Rung): string =>
  `${key}|${channel}|${rung}`;

/** The five directions cards were keyed by before the ladder. Read by review
 *  rows written then, and by cards arriving from a device that has not
 *  migrated. */
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
 *  `speak` is null: those cards retire and only their reviews survive. */
export const LEGACY_RUNG: Record<LegacyDirection, readonly [Channel, Rung] | null> = {
  fr_en: ['written', 'recognise'],
  en_fr: ['written', 'write'],
  audio_en: ['heard', 'hear'],
  audio_fr: ['heard', 'dictate'],
  speak: null,
};

/** `DIRECTION_LABEL`, widened to plain string keys. */
const LABEL_BY_DIRECTION: Record<string, string> = DIRECTION_LABEL;
/** `RUNG_LABEL`, widened to plain string keys. */
const LABEL_BY_RUNG: Record<string, string> = RUNG_LABEL;

/** The label for whatever a review row says it was: a rung as
 *  `"written/write"`, or one of the old direction names. Falls back to the raw
 *  string, so a row from a future shape still prints as something. */
export function exerciseLabel(direction: string): string {
  const legacy = LABEL_BY_DIRECTION[direction];
  if (legacy) return legacy;
  const rung = direction.split('/')[1] ?? '';
  return LABEL_BY_RUNG[rung] ?? direction;
}
