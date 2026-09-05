import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examplesFor, splitOnForm } from '../src/lib/examples.js';

test('the matched form is found as a whole word, after an apostrophe too', () => {
  assert.deepEqual(splitOnForm("J'ai mangé.", 'ai mangé'), ["J'", 'ai mangé', '.']);
  assert.deepEqual(splitOnForm('Allons-y doucement.', 'allons'), ['', 'Allons', '-y doucement.']);
  assert.deepEqual(splitOnForm('Il faut que je mange.', 'mange'), ['Il faut que je ', 'mange', '.']);
});

test('a form inside another word is not highlighted', () => {
  assert.deepEqual(splitOnForm('Elle mangeait.', 'mange'), ['Elle mangeait.', '', '']);
});

test('examples come from the shipped table, with a source only when there are some', () => {
  const conj = { examples: { pres: [{ fr: 'Je mange ici.', en: 'I eat here.', f: 'mange' }] } };
  assert.equal(examplesFor(conj, 'pres').examples.length, 1);
  assert.match(examplesFor(conj, 'pres').source, /Tatoeba/);
  assert.deepEqual(examplesFor(conj, 'subj'), { examples: [], source: '' });
  assert.deepEqual(examplesFor(undefined, 'subj').examples, []);
});
