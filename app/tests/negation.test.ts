/** The negation generator: *ne … pas* around the verb, *n'* before a
 *  vowel, *je* whole again — and the sentences the rule alone does not
 *  handle, left out rather than answered wrongly.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { negate, negationFor, negationsFor } from '../src/lib/grammar/negation.js';
import { answerCells } from '../src/lib/grammar/instance.js';
import { word } from './make.js';

const ex = (fr: string, f: string, en = '', id?: number) => ({ fr, f, en, ...(id === undefined ? {} : { id }) });

test('ne before the verb and pas after it; n’ before a vowel; j’ becomes je again', () => {
  const table: [string, string, string, boolean][] = [
    ['Nous parlons français.', 'parlons', 'Nous ne parlons pas français.', false],
    ['Il parle trop vite.', 'parle', 'Il ne parle pas trop vite.', false],
    ["J'aime le café.", 'aime', "Je n'aime pas le café.", true],
    ['Tu habites ici ?', 'habites', "Tu n'habites pas ici ?", true],
    ['Elle est là.', 'est', "Elle n'est pas là.", true],
    ['Les enfants jouent dehors.', 'jouent', 'Les enfants ne jouent pas dehors.', false],
    ['Nous vous écoutons.', 'écoutons', null as unknown as string, false],
  ];
  for (const [fr, f, want, elided] of table) {
    const made = negate(ex(fr, f));
    if (want === null) { assert.equal(made, null, fr); continue; }
    assert.equal(made?.answer, want, fr);
    assert.equal(made?.elided, elided, `${fr}: elided`);
  }
});

test('a sentence the rule alone does not handle is not dealt', () => {
  const skipped: [string, string, string][] = [
    ['Je ne parle pas anglais.', 'parle', 'negative already'],
    ["Il n'aime pas ça.", 'aime', 'negative already, elided'],
    ['Je le vois.', 'vois', 'an object pronoun before the verb'],
    ["Il l'achète.", 'achète', 'an elided object pronoun'],
    ['Parle-t-il français ?', 'Parle', 'inverted'],
    ['Il a une voiture.', 'a', 'un becomes de: another rule'],
    ['Nous mangeons du pain.', 'mangeons', 'du becomes de'],
    ['Elle a parlé.', 'a parlé', 'a compound form'],
    ['Il nous parle.', 'parle', 'nous is the object here'],
  ];
  for (const [fr, f, why] of skipped) assert.equal(negate(ex(fr, f)), null, `${fr}: ${why}`);
});

test('the exercise carries the sentence, its id, and observes elision only where n’ applies', () => {
  const v = word({ k: 'aimer|verb', conj: {
    lemma: 'aimer', aux: 'avoir', shape: '', groups: [], compound: [], impersonal: [], links: [],
    examples: { pres: [ex("J'aime le café.", 'aime', 'I like coffee.', 42), ex('Nous aimons ça.', 'aimons', 'We like that.'),
      ex('Il le sait.', 'sait', '', 43)] },
  } });
  const all = negationsFor(v);
  assert.deepEqual(all.map((i) => i.id), ['sentence:aimer|verb:42:G.pas'],
    'one has no corpus id, one has an object pronoun');
  const [it] = all;
  assert.equal(it?.face, 'transform');
  assert.equal(it?.rule, 'G.pas');
  assert.equal(it?.hint, 'I like coffee.');
  assert.deepEqual(it?.sentence, ex("J'aime le café.", 'aime', 'I like coffee.', 42));
  assert.deepEqual(it?.cells[0]?.obs, [{ of: 'G.pas', on: 'form' }, { of: 'P.elision', on: 'form' }]);
  const plain = negationFor(v, ex('Nous parlons.', 'parlons', '', 7));
  assert.deepEqual(plain?.cells[0]?.obs, [{ of: 'G.pas', on: 'form' }]);
});

test('the answer is judged loosely on what a keyboard does, strictly on the words', () => {
  const v = word({ k: 'aimer|verb', conj: {
    lemma: 'aimer', aux: 'avoir', shape: '', groups: [], compound: [], impersonal: [], links: [],
    examples: { pres: [ex("J'aime le café.", 'aime', '', 1)] },
  } });
  const [it] = negationsFor(v);
  assert.ok(it);
  const ok = (typed: string): boolean => answerCells(it, [typed])[0]!.ok;
  assert.equal(ok("Je n'aime pas le café."), true);
  assert.equal(ok('Je n’aime pas le café'), true, 'a curly apostrophe and no full stop');
  assert.equal(ok('je n\'aime  pas le café.'), true, 'case and spacing');
  assert.equal(ok("Je ne aime pas le café."), false, 'no elision');
  assert.equal(ok("Je n'aime le café pas."), false, 'pas in the wrong place');
});
