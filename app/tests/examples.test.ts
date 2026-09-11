/** Example sentences: which ones a tense has, and where the form stands in one. */
import { expect, test } from 'vitest';

import { examplesFor, splitOnForm } from '../src/lib/examples';
import type { Conjugation } from '../src/lib/types';

test('the matched form is found as a whole word, after an apostrophe too', () => {
  expect(splitOnForm("J'ai mangé.", 'ai mangé')).toEqual(["J'", 'ai mangé', '.']);
  expect(splitOnForm('Allons-y doucement.', 'allons')).toEqual(['', 'Allons', '-y doucement.']);
  expect(splitOnForm('Il faut que je mange.', 'mange')).toEqual([
    'Il faut que je ',
    'mange',
    '.',
  ]);
});

test('a form inside another word is not highlighted', () => {
  expect(splitOnForm('Elle mangeait.', 'mange')).toEqual(['Elle mangeait.', '', '']);
});

test('examples come from the shipped table, with a source only when there are some', () => {
  /** A verb table carrying one present-tense sentence and nothing else, which
   *  is all `examplesFor` reads of a conjugation. */
  const conj: Pick<Conjugation, 'examples'> = {
    examples: { pres: [{ fr: 'Je mange ici.', en: 'I eat here.', f: 'mange' }] },
  };
  expect(examplesFor(conj, 'pres').examples.length).toBe(1);
  expect(examplesFor(conj, 'pres').source).toMatch(/Tatoeba/);
  expect(examplesFor(conj, 'subj')).toEqual({ examples: [], source: '' });
  expect(examplesFor(undefined, 'subj').examples).toEqual([]);
});
