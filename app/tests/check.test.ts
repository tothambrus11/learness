/** Grading what was typed: how forgiving each verdict is, and what it is worth. */
import { Rating } from 'ts-fsrs';
import { expect, test } from 'vitest';

import {
  checkCloze,
  checkEnglish,
  checkFrench,
  norm,
  ratingFor,
  sameWord,
} from '../src/lib/check';
import type { EnglishAnswer, FrenchAnswer } from '../src/lib/check';

/** A word as both sides of a card read it: the stored French form with its
 *  bare lemma, and the translations any one of which is a right answer. */
type Answerable = FrenchAnswer & EnglishAnswer;

/** An English loanword: no accents, so only the article is at stake. */
const bug: Answerable = { answer: 'le bug', lemma: 'bug', en: ['bug'] };

/** A long word with an accent, which is what tells `accent` from `close`. */
const dev: Answerable = {
  answer: 'le développement',
  lemma: 'développement',
  en: ['development'],
};

/** A word with three accepted translations, for the English side. */
const chat: Answerable = { answer: 'le chat', lemma: 'chat', en: ['cat', 'tom', 'tomcat'] };

test('normalising folds accents and ligatures', () => {
  expect(norm('Développé')).toBe('developpe');
  expect(norm('œuf')).toBe('oeuf');
  expect(norm('  Le   BUG ')).toBe('le bug');
});

test('an exact answer is correct', () => {
  expect(checkFrench('le bug', bug).verdict).toBe('ok');
});

test('a missing accent is accepted, with a note', () => {
  expect(checkFrench('le developpement', dev).verdict).toBe('accent');
});

test('a missing article is accepted, with a note', () => {
  expect(checkFrench('bug', bug).verdict).toBe('article');
  expect(checkFrench('développement', dev).verdict).toBe('article');
});

test('a typo is close, not wrong', () => {
  expect(checkFrench('le developement', dev).verdict).toBe('close');
});

test('a different word is wrong', () => {
  expect(checkFrench('la voiture', bug).verdict).toBe('no');
  expect(checkFrench('', bug).verdict).toBe('no');
});

test('a noun of either gender takes either article', () => {
  /** The pair form the catalogue stores a noun of either gender under. */
  const ministre: Answerable = {
    answer: 'le/la ministre',
    lemma: 'ministre',
    en: ['minister'],
  };
  expect(checkFrench('le ministre', ministre).verdict).toBe('ok');
  expect(checkFrench('la ministre', ministre).verdict).toBe('ok');
  expect(checkFrench('ministre', ministre).verdict).toBe('article');
  expect(checkFrench('le ministère', ministre).verdict).toBe('close');
  expect(
    checkFrench('le/la ministre', ministre).verdict,
    'the pair is a card, not French',
  ).toBe('no');
});

test('a blank in a sentence wants the form that stands there', () => {
  expect(checkCloze('sont', 'sont').verdict).toBe('ok');
  expect(checkCloze('Sont', 'sont').verdict).toBe('ok');
  expect(checkCloze('etes', 'êtes').verdict).toBe('accent');
  expect(checkCloze('sonts', 'sont').verdict).toBe('close');
  expect(checkCloze('être', 'sont').verdict, 'the lemma is not the answer').toBe('no');
  expect(checkCloze('', 'sont').verdict).toBe('no');
});

test('any stored translation counts on the English side', () => {
  expect(checkEnglish('tomcat', chat).verdict).toBe('ok');
  expect(checkEnglish('a cat', chat).verdict).toBe('ok');
  expect(checkEnglish('dog', chat).verdict).toBe('no');
});

test('verdicts map onto the four-point rating scale', () => {
  expect(ratingFor('ok')).toBe(Rating.Good);
  expect(ratingFor('close')).toBe(Rating.Hard);
  expect(ratingFor('no')).toBe(Rating.Again);
});

test('one word by any of its spellings, for matching rather than grading', () => {
  expect(
    sameWord('le/la bus', 'le bus'),
    'the catalogue stores a noun of either gender as one pair',
  ).toBe(true);
  expect(sameWord('le/la bus', 'le/la bus'), 'and a pair matches itself').toBe(true);
  expect(sameWord('le/la bus', 'bus')).toBe(true);
  expect(sameWord('le/la bus', 'la bus')).toBe(true);
  expect(sameWord('un/une élève', "l'élève")).toBe(true);
  expect(sameWord('la source', 'source')).toBe(true);
  expect(sameWord("l'eau", 'eau')).toBe(true);
  expect(sameWord('le bus', 'le buste')).toBe(false);
  expect(sameWord('le bus', '')).toBe(false);
  expect(sameWord('', '')).toBe(false);
});
