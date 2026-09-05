/** A word's identity, stable across catalogue rebuilds.
 *  Progress is keyed on this, never on a row id, so regenerating the catalogue
 *  can never detach a word from its history. */
export const wordKey = (lemma, pos) => `${lemma}|${pos}`;

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
export const CHANNELS = ['written', 'heard'];
export const RUNGS = {
  written: ['recognise', 'say', 'write', 'use'],
  heard: ['hear', 'dictate'],
};
export const CHANNEL_LABEL = { written: 'Written', heard: 'Heard' };
export const RUNG_LABEL = {
  recognise: 'Read FR → EN',
  say: 'Say it, then check',
  write: 'Write it',
  use: 'Use it in a sentence',
  hear: 'Listen → meaning',
  dictate: 'Listen → write',
};
/** Rungs that need no keyboard: the ones a walk can serve. */
export const HANDS_FREE = new Set(['recognise', 'say', 'hear']);
/** Rungs where the answer is typed and checked rather than self-judged. */
export const TYPED = new Set(['write', 'dictate', 'use']);

/** Where a word enters each ladder is decided by how much it resembles its
 *  English — on the page, and out loud. Above these, the first rung would be
 *  a review passed at 100% before anything was studied. */
export const LOOKS_FREE = 0.75;
export const SOUNDS_FREE = 0.70;

export const MATURE_STABILITY = 21;   // days of memory half-life

/** Each rung is its own FSRS card, because a new rung tests a different
 *  memory and inherits an unknown share of the old one. */
export const cardId = (key, channel, rung) => `${key}|${channel}|${rung}`;

/* The five directions cards were keyed by before the ladder. Kept so old
   review rows still label themselves, and so a card that arrives from a
   device that has not migrated can be placed on the rung it implies. */
export const DIRECTIONS = ['fr_en', 'en_fr', 'audio_fr', 'audio_en', 'speak'];
export const DIRECTION_LABEL = {
  fr_en: 'Read FR→EN',
  en_fr: 'Recall EN→FR',
  audio_fr: 'Listen → write FR',
  audio_en: 'Listen → meaning',
  speak: 'Speak',
};
export const LEGACY_RUNG = {
  fr_en: ['written', 'recognise'],
  en_fr: ['written', 'write'],
  audio_en: ['heard', 'hear'],
  audio_fr: ['heard', 'dictate'],
  speak: null,       /* graded by a recogniser that dropped the article; retired */
};

/** The label for whatever a review row says it was: a rung, or an old direction. */
export function exerciseLabel(direction) {
  if (DIRECTION_LABEL[direction]) return DIRECTION_LABEL[direction];
  const rung = String(direction || '').split('/')[1];
  return RUNG_LABEL[rung] ?? direction;
}
