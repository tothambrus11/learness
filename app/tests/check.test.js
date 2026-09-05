import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCloze, checkEnglish, checkFrench, norm, ratingFor } from '../src/lib/check.js';

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

test('a noun of either gender takes either article', () => {
  const ministre = { answer: 'le/la ministre', lemma: 'ministre', en: ['minister'] };
  assert.equal(checkFrench('le ministre', ministre).verdict, 'ok');
  assert.equal(checkFrench('la ministre', ministre).verdict, 'ok');
  assert.equal(checkFrench('ministre', ministre).verdict, 'article');
  assert.equal(checkFrench('le ministère', ministre).verdict, 'close');
  assert.equal(checkFrench('le/la ministre', ministre).verdict, 'no', 'the pair is a card, not French');
});

test('a blank in a sentence wants the form that stands there', () => {
  assert.equal(checkCloze('sont', 'sont').verdict, 'ok');
  assert.equal(checkCloze('Sont', 'sont').verdict, 'ok');
  assert.equal(checkCloze('etes', 'êtes').verdict, 'accent');
  assert.equal(checkCloze('sonts', 'sont').verdict, 'close');
  assert.equal(checkCloze('être', 'sont').verdict, 'no', 'the lemma is not the answer');
  assert.equal(checkCloze('', 'sont').verdict, 'no');
});

test('any stored translation counts on the English side', () => {
  assert.equal(checkEnglish('tomcat', chat).verdict, 'ok');
  assert.equal(checkEnglish('a cat', chat).verdict, 'ok');
  assert.equal(checkEnglish('dog', chat).verdict, 'no');
});

test('verdicts map onto the four-point rating scale', () => {
  assert.equal(ratingFor('ok'), 3);
  assert.equal(ratingFor('close'), 2);
  assert.equal(ratingFor('no'), 1);
});
