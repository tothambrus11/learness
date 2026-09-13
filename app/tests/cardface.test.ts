/** What a card puts on screen, decided away from the screen.
 *
 *  These four used to live inside the study page's template, where nothing
 *  could reach them: the sentence a card blanks, where the blank falls, which
 *  English to read out, and which senses are worth printing under an answer
 *  that already says one of them.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { blank, cueOf, senses, sentenceAt, sentenceFor } from '../src/lib/cardface.js';
import { card, word } from './make.js';
import type { StudyItem } from '../src/lib/queue.js';
import type { Example } from '../src/lib/model.js';

const ex = (fr: string, f: string, en = ''): Example => ({ fr, f, en });

const item = (over: Partial<StudyItem['word']> = {}, reps = 0): StudyItem => ({
  card: card('bug|noun', 'written', 'use', { reps }),
  word: word(over),
});

test('the cue is the catalogue’s, or the first translation up to the semicolon', () => {
  assert.equal(cueOf(word({ cue: 'the day' })), 'the day');
  assert.equal(cueOf(word({ en: ['day; daytime', 'light'] })), 'day');
  assert.equal(cueOf(word({ en: [] })), '');
});

test('a card asks about the sentence its own rep count lands on', () => {
  /* Not at random: the card you look back at has to show the sentence you
     were actually asked, and the same card next week a different one. */
  const three = [ex('un', 'un'), ex('deux', 'deux'), ex('trois', 'trois')];
  assert.equal(sentenceAt(item({ ex: three }, 0)), 0);
  assert.equal(sentenceAt(item({ ex: three }, 4)), 1);
  assert.equal(sentenceFor(item({ ex: three }, 5))?.fr, 'trois');
});

test('a word with no sentences has none, and nothing asks for one', () => {
  assert.equal(sentenceAt(item({ ex: [] })), -1);
  assert.equal(sentenceFor(item({ ex: [] })), null);
  assert.equal(sentenceAt(null), -1);
  assert.equal(sentenceFor(undefined), null);
});

test('the gap is cut where the word stands, on a letter boundary', () => {
  assert.deepEqual(blank(ex('Il est parti le jour même.', 'jour')),
    { before: 'Il est parti le ', after: ' même.' });
  /* "an" inside "dans" is not the word: a blank there would ask about a
     sentence that no longer reads. */
  assert.deepEqual(blank(ex('Dans un an, peut-être.', 'an')),
    { before: 'Dans un ', after: ', peut-être.' });
  assert.deepEqual(blank(ex("C'est l'été.", 'été')),
    { before: "C'est l'", after: '.' });
});

test('a sentence whose form cannot be found is shown whole rather than blank', () => {
  assert.deepEqual(blank(ex('Il pleut.', 'neiger')), { before: 'Il pleut.', after: '' });
});

test('the senses under the answer never repeat the answer itself', () => {
  const w = word({ en: ['day', 'daylight'], def: { en: ['day, daytime', 'daylight'] } });
  assert.deepEqual(senses(w), ['day, daytime', 'daylight']);
  assert.deepEqual(senses(word({ en: ['day'], def: {} })), [], 'nothing left to say');
  assert.deepEqual(senses(null), []);
});
