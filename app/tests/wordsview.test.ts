/** The words list shows each word exactly as the card will.
 *
 *  It once showed a third thing — its own stored record — so a gender
 *  corrected on this screen read one way in the list and another on the
 *  card (#22). And the form's rules: what it reads out of a record, what it
 *  writes back, and the one warning it gives.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { EMPTY_FORM, formOf, fromForm, gloss, guardSave, parseEn, saveWarning }
  from '../src/lib/wordsview.js';
import { freshApp, smallCatalogue } from './harness.js';
import { userWord } from './make.js';

test('the form reads a record out and writes it back, and only a noun keeps a gender', () => {
  const rec = userWord({ fr: 'le natel', en: ['mobile phone', 'cell phone'], pos: 'noun',
    gender: 'm', number: '', note: 'Swiss' });
  const form = formOf(rec);
  assert.deepEqual(form, { fr: 'le natel', en: 'mobile phone · cell phone', pos: 'noun',
    gender: 'm', number: '', note: 'Swiss' });
  assert.deepEqual(fromForm(form), { fr: 'le natel', en: ['mobile phone', 'cell phone'],
    pos: 'noun', gender: 'm', number: '', note: 'Swiss' });
  const verb = fromForm({ ...form, fr: ' bosser ', pos: 'verb' });
  assert.equal(verb.gender, '', 'a verb has no gender, whatever the form still held');
  assert.equal(verb.fr, 'bosser');
  assert.equal(formOf(userWord({ pos: '' })).pos, 'other', 'a record with no part of speech');
});

test('the English box splits on whatever separates translations', () => {
  assert.deepEqual(parseEn('day, daytime; light · a day'), ['day', 'daytime', 'light', 'a day']);
  assert.deepEqual(parseEn('  '), []);
  assert.equal(gloss({ en: ['a', 'b', 'c', 'd'] }), 'a · b · c');
  assert.equal(gloss({ en: 'one string' }), 'one string');
});

test('a word with no English is warned about once, and no other word is', () => {
  assert.equal(saveWarning({ ...EMPTY_FORM, fr: 'le natel' }),
    'No English yet — this card cannot be asked until it has one. Save it anyway?');
  assert.equal(saveWarning({ ...EMPTY_FORM, fr: 'le natel', en: 'phone' }), '');
  assert.equal(saveWarning({ ...EMPTY_FORM }),
    'No French and English yet — this card cannot be asked until it has one. Save it anyway?');
});

test('the warning stands until the second press, which saves anyway', () => {
  /* Half a word written down beats a word forgotten: the first press says
     what is missing, the second saves regardless. A word with nothing
     missing is never stopped. */
  const short = { ...EMPTY_FORM, fr: 'le natel' };
  const first = guardSave(short, '');
  assert.equal(first.proceed, false);
  assert.match(first.warning, /No English yet/);
  assert.deepEqual(guardSave(short, first.warning), { proceed: true, warning: '' },
    'the second press, with the warning standing');
  assert.deepEqual(guardSave({ ...short, en: 'phone' }, ''), { proceed: true, warning: '' });
  assert.deepEqual(guardSave({ ...short, en: 'phone' }, first.warning), { proceed: true, warning: '' },
    'and a form made whole under a standing warning saves without one');
});

test('the list shows a corrected word as the card does, not as it was stored', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { rowsFor } = await import('../src/lib/wordsview.js');
  const { record } = await app.words.addWord({ fr: 'le temps', en: ['time'] });
  await app.words.editWord(record.k, { gender: 'f' });
  const rows = await rowsFor(await app.words.activeUserWords(), await app.db.allCards());
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.shown.gender, 'f', 'the correction, as the card sees it');
  assert.equal(rows[0]?.shown.lvl, 1, 'over the catalogue’s record');
  assert.equal(rows[0]?.status, 'up next', 'read off its card');
  assert.deepEqual(rows[0]?.missing, []);
});

test('a word of your own with no clip yet has nothing to play, and one without English says so', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { rowsFor } = await import('../src/lib/wordsview.js');
  await app.words.addWord({ fr: 'natel', en: [], pos: 'noun', gender: 'm' });
  const rows = await rowsFor(await app.words.activeUserWords(), await app.db.allCards());
  assert.equal(rows[0]?.playable, false);
  assert.deepEqual(rows[0]?.missing, ['English']);
  assert.equal(rows[0]?.shown.fr, 'le natel', 'shown the way the catalogue shows a noun');
});
