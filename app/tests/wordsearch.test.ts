/** What someone typed, against what is written down.
 *
 *  Two lists are searched with these rules — the catalogue and the dictionary —
 *  and they used to be one copy in catalogue.ts. The rules are about a learner,
 *  not about strings: what is typed is what was heard, and an accent, an
 *  article or a capital is not a different word.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { bare, fold, queryOf, score } from '../src/lib/wordsearch.js';

const of = (q: string) => queryOf(q);

test('a word folds to what a search compares: no case, no accents, no stops', () => {
  assert.equal(fold('Le Jour.'), 'le jour');
  assert.equal(fold("l'Été"), "l'ete");
  assert.equal(fold('  '), '');
  assert.equal(fold(null), '');
});

test('the article comes off, however it is written', () => {
  assert.equal(bare('le jour'), 'jour');
  assert.equal(bare("l'oubli"), 'oubli');
  assert.equal(bare('le/la ministre'), 'ministre');
  assert.equal(bare('les gens'), 'gens');
  assert.equal(bare('chaussette'), 'chaussette', 'a word with no article is the word');
  assert.equal(bare('lessive'), 'lessive', '"les" is not an article here');
});

test('a word is found by the word, with or without its article', () => {
  for (const typed of ['jour', 'le jour', 'Jour', 'LE JOUR']) {
    assert.equal(score(of(typed), 'le jour', ['day']), 100, typed);
  }
});

test('an exact word beats a prefix, and a prefix beats what merely contains it', () => {
  const q = of('jour');
  assert.equal(score(q, 'le jour', ['day']), 100);
  assert.ok(score(q, 'le journal', ['newspaper']) < 100);
  assert.ok(score(q, 'le journal', []) > score(q, 'la bonjournade', []));
});

test('the shorter of two words with the same prefix ranks first', () => {
  /* "jour" before "journalisme": both start with what was typed, and the one
     with less left over is the nearer answer. */
  const q = of('jour');
  assert.ok(score(q, 'le journal', []) > score(q, 'le journalisme', []));
});

test('the English answers too, below anything the French matched', () => {
  const q = of('day');
  assert.ok(score(q, 'le jour', ['day']) > 0);
  assert.ok(score(q, 'le jour', ['day']) < score(of('jour'), 'le jour', ['day']));
  assert.ok(score(q, 'la journée', ['the whole day']) > 0, 'a gloss that contains it');
  assert.equal(score(q, 'le pont', ['bridge']), 0);
});

test('an empty search matches nothing at all', () => {
  assert.equal(score(of(''), 'le jour', ['day']), 0);
  assert.equal(score(of('  '), 'le jour', ['day']), 0);
  assert.equal(score(of('le'), 'le jour', ['day']), 0, 'an article on its own is not a word');
});
