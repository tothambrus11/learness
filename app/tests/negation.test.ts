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

test('after a negation un, une, du and des become de — d’ before a vowel — and never after être', () => {
  const table: [string, string, string | null][] = [
    ['Il a une voiture.', 'a', "Il n'a pas de voiture."],
    ['Nous mangeons du pain.', 'mangeons', 'Nous ne mangeons pas de pain.'],
    ['Elle a des amis.', 'a', "Elle n'a pas d'amis."],
    ["J'ai un ami.", 'ai', "Je n'ai pas d'ami."],
    ["C'est une voiture.", 'est', null],
  ];
  for (const [fr, f, want] of table) {
    assert.equal(negate(ex(fr, f), { deAfter: true })?.answer ?? null, want, fr);
    assert.equal(negate(ex(fr, f)), null, `${fr}: not the plain rule’s`);
  }
  assert.equal(negate(ex('Il parle trop vite.', 'parle'), { deAfter: true }), null, 'nothing for that rule to do');
});

test('jamais and plus take the place of pas, and one exercise asks for both', () => {
  assert.equal(negate(ex('Il parle trop vite.', 'parle'), { word: 'jamais' })?.answer, 'Il ne parle jamais trop vite.');
  assert.equal(negate(ex('Il parle trop vite.', 'parle'), { word: 'plus' })?.answer, 'Il ne parle plus trop vite.');
  assert.equal(negate(ex('Il ne parle jamais.', 'parle'), { word: 'plus' }), null, 'negative already');
  const v = word({ k: 'parler|verb', conj: {
    lemma: 'parler', aux: 'avoir', shape: '', groups: [], compound: [], impersonal: [], links: [],
    examples: { pres: [ex('Nous parlons français.', 'parlons', 'We speak French.', 1001), ex('Il a une voiture.', 'a', '', 2)] },
  } });
  const [others] = negationsFor(v, 'G.others');
  assert.equal(others?.id, 'sentence:parler|verb:1001:G.others');
  assert.deepEqual(others?.cells.map((c) => [c.prompt, c.expected]),
    [['never', 'Nous ne parlons jamais français.'], ['no longer', 'Nous ne parlons plus français.']]);
  assert.deepEqual(others?.cells[0]?.obs, [{ of: 'G.others', on: 'form' }, { of: 'G.pas', on: 'form' }]);
  const [de] = negationsFor(v, 'D.de-negative');
  assert.equal(de?.id, 'sentence:parler|verb:2:D.de-negative', 'the sentence the plain rule leaves out');
  assert.deepEqual(de?.cells[0]?.obs, [{ of: 'D.de-negative', on: 'form' }, { of: 'G.pas', on: 'form' }, { of: 'P.elision', on: 'form' }]);
  assert.deepEqual(negationsFor(v).map((i) => i.id), ['sentence:parler|verb:1001:G.pas'], 'the plain rule: the other sentence');
});
