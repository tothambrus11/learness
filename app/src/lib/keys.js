/** A word's identity, stable across catalogue rebuilds.
 *  Progress is keyed on this, never on a row id, so regenerating the catalogue
 *  can never detach a word from its history. */
export const wordKey = (lemma, pos) => `${lemma}|${pos}`;

export const DIRECTIONS = ['fr_en', 'en_fr', 'audio_fr', 'audio_en', 'speak'];

export const DIRECTION_LABEL = {
  fr_en: 'Read FR→EN',
  en_fr: 'Recall EN→FR',
  audio_fr: 'Listen → write FR',
  audio_en: 'Listen → meaning',
  speak: 'Speak',
};

/** A direction opens once its prerequisite is known. Speaking has none: it is a
 *  practice mode over words you have already met, usable from day one. */
export const PREREQ = { en_fr: 'fr_en', audio_fr: 'en_fr', audio_en: 'fr_en' };

export const MATURE_STABILITY = 21;   // days of memory half-life

export const cardId = (key, direction) => `${key}|${direction}`;
