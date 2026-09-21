/** The est-ce que question: the statement with the question in front,
 *  qu’ before a vowel, the capital lowered unless it is a name.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { askWith, questionsFor } from '../src/lib/grammar/questions.js';
import { word } from './make.js';

const ex = (fr: string, f: string, en = '', id?: number) => ({ fr, f, en, ...(id === undefined ? {} : { id }) });

test('est-ce que in front, a question mark at the end, and qu’ before a vowel', () => {
  const table: [string, string, string | null][] = [
    ['Nous parlons français.', 'parlons', 'Est-ce que nous parlons français ?'],
    ['Il parle trop vite.', 'parle', "Est-ce qu'il parle trop vite ?"],
    ["J'aime le café.", 'aime', "Est-ce que j'aime le café ?"],
    ['Marie parle français.', 'parle', 'Est-ce que Marie parle français ?'],
    ['Elle est là.', 'est', "Est-ce qu'elle est là ?"],
    ['Tu habites ici ?', 'habites', null],
    ['Parle plus fort !', 'Parle', null],
    ['Est-ce que tu viens ?', 'viens', null],
  ];
  for (const [fr, f, want] of table) assert.equal(askWith(ex(fr, f))?.answer ?? null, want, fr);
  assert.equal(askWith(ex('Il parle.', 'parle'))?.elided, true);
  assert.equal(askWith(ex('Nous parlons.', 'parlons'))?.elided, false);
});

test('the exercise carries the sentence and observes elision only where qu’ applies', () => {
  const v = word({ k: 'parler|verb', conj: {
    lemma: 'parler', aux: 'avoir', shape: '', groups: [], compound: [], impersonal: [], links: [],
    examples: { pres: [ex('Il parle trop vite.', 'parle', 'He talks too fast.', 1004), ex('Nous parlons.', 'parlons')] },
  } });
  const [q] = questionsFor(v);
  assert.equal(questionsFor(v).length, 1, 'one has no corpus id');
  assert.equal(q?.id, 'sentence:parler|verb:1004:Q.yes-no');
  assert.equal(q?.rule, 'Q.yes-no');
  assert.equal(q?.face, 'transform');
  assert.deepEqual(q?.cells[0]?.obs, [{ of: 'Q.yes-no', on: 'form' }, { of: 'P.elision', on: 'form' }]);
  assert.equal(q?.sentence?.fr, 'Il parle trop vite.');
});
