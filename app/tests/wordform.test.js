import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIncomplete, listFields, missingFields, sortForList } from '../src/lib/wordform.js';

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
