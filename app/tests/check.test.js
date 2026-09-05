import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnglish, checkFrench, checkSpoken, norm, ratingFor } from '../src/lib/check.js';

const bug = { answer: 'le bug', lemma: 'bug', en: ['bug'] };
const dev = { answer: 'le développement', lemma: 'développement', en: ['development'] };
const chat = { answer: 'le chat', lemma: 'chat', en: ['cat', 'tom', 'tomcat'] };

test('normalising folds accents and ligatures', () => {
  assert.equal(norm('Développé'), 'developpe');
  assert.equal(norm('œuf'), 'oeuf');
  assert.equal(norm('  Le   BUG '), 'le bug');
});

test('an exact answer is correct', () => {
  assert.equal(checkFrench('le bug', bug).verdict, 'ok');
});

test('a missing accent is accepted, with a note', () => {
  assert.equal(checkFrench('le developpement', dev).verdict, 'accent');
});

test('a missing article is accepted, with a note', () => {
  assert.equal(checkFrench('bug', bug).verdict, 'article');
  assert.equal(checkFrench('développement', dev).verdict, 'article');
});

test('a typo is close, not wrong', () => {
  assert.equal(checkFrench('le developement', dev).verdict, 'close');
});

test('a different word is wrong', () => {
  assert.equal(checkFrench('la voiture', bug).verdict, 'no');
  assert.equal(checkFrench('', bug).verdict, 'no');
});

test('any stored translation counts on the English side', () => {
  assert.equal(checkEnglish('tomcat', chat).verdict, 'ok');
  assert.equal(checkEnglish('a cat', chat).verdict, 'ok');
  assert.equal(checkEnglish('dog', chat).verdict, 'no');
});

test('speech is graded across every alternative the recogniser offers', () => {
  assert.equal(checkSpoken(['le bug'], bug).verdict, 'ok');
  assert.equal(checkSpoken(['bug'], bug).verdict, 'ok');
  assert.equal(checkSpoken(['bugue', 'le bug'], bug).verdict, 'ok');
  assert.equal(checkSpoken(['bonjour'], bug).verdict, 'no');
  assert.equal(checkSpoken([], bug).verdict, 'no', 'silence is not a pass');
});

test('verdicts map onto the four-point rating scale', () => {
  assert.equal(ratingFor('ok'), 3);
  assert.equal(ratingFor('close'), 2);
  assert.equal(ratingFor('no'), 1);
});
