import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIncomplete, listFields, matchWords, missingFields, sortForList }
  from '../src/lib/wordform.js';

test('a word with no English cannot be asked, and says so', () => {
  assert.deepEqual(missingFields({ fr: 'le bus', en: ['bus'] }), []);
  assert.deepEqual(missingFields({ fr: 'le bus', en: [] }), ['English']);
  assert.deepEqual(missingFields({ fr: 'le bus', en: [''] }), ['English']);
  assert.deepEqual(missingFields({ fr: 'le bus' }), ['English']);
  assert.deepEqual(missingFields({ fr: '  ', en: [] }), ['French', 'English']);
  assert.deepEqual(missingFields({ fr: 'le bus', en: 'bus' }), [], 'a plain string counts');
  assert.equal(isIncomplete({ fr: 'le bus', en: ['bus'] }), false);
  assert.equal(isIncomplete({ fr: 'le bus', en: [] }), true);
});

test('unfinished words come first, then the newest', () => {
  const rows = [
    { k: 'a', fr: 'a', en: ['a'], addedAt: 3 },
    { k: 'b', fr: 'b', en: [], addedAt: 1 },
    { k: 'c', fr: 'c', en: ['c'], addedAt: 5 },
    { k: 'd', fr: 'd', en: [], addedAt: 2 },
  ];
  assert.deepEqual(sortForList(rows).map((r) => r.k), ['d', 'b', 'c', 'a']);
  assert.deepEqual(rows.map((r) => r.k), ['a', 'b', 'c', 'd'], 'the list itself is left alone');
});

test('missing fields are read out as a sentence would', () => {
  assert.equal(listFields([]), '');
  assert.equal(listFields(['English']), 'English');
  assert.equal(listFields(['French', 'English']), 'French and English');
});

test('the list answers the search box, in either language', () => {
  const mine = [
    { k: 'a', fr: 'le bus', en: ['bus', 'coach'] },
    { k: 'b', fr: "l'école", en: ['school'] },
    { k: 'c', fr: 'le natel', en: ['mobile phone'] },
  ];
  const keys = (q) => matchWords(mine, q).map((w) => w.k);
  assert.deepEqual(keys('bus'), ['a'], 'the article is not in the way');
  assert.deepEqual(keys('le bus'), ['a']);
  assert.deepEqual(keys('ecole'), ['b'], 'accents are not in the way either');
  assert.deepEqual(keys('école'), ['b']);
  assert.deepEqual(keys('school'), ['b'], 'the English side counts');
  assert.deepEqual(keys('phone'), ['c'], 'and part of it is enough');
  assert.deepEqual(keys('zzz'), []);
  assert.deepEqual(keys(''), ['a', 'b', 'c'], 'an empty box narrows nothing');
  assert.deepEqual(keys('   '), ['a', 'b', 'c']);
});

test('matching leaves the list it was given alone', () => {
  const mine = [{ k: 'a', fr: 'le bus', en: ['bus'] }];
  assert.notEqual(matchWords(mine, ''), mine);
  assert.deepEqual(matchWords(undefined, 'bus'), []);
});
