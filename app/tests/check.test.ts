import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  checkChoice, checkCloze, checkEnglish, checkFrench, nearMiss, norm, ratingFor, sameWord,
} from '../src/lib/check.js';

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

test('one word by any of its spellings, for matching rather than grading', () => {
  /* The catalogue stores a noun of either gender as a pair. Comparing that
     spelling literally is why "le/la bus" could not be added: it matched
     neither the catalogue nor itself. */
  assert.equal(sameWord('le/la bus', 'le bus'), true);
  assert.equal(sameWord('le/la bus', 'le/la bus'), true);
  assert.equal(sameWord('le/la bus', 'bus'), true);
  assert.equal(sameWord('le/la bus', 'la bus'), true);
  assert.equal(sameWord('un/une élève', "l'élève"), true);
  assert.equal(sameWord('la source', 'source'), true);
  assert.equal(sameWord("l'eau", 'eau'), true);
  assert.equal(sameWord('le bus', 'le buste'), false);
  assert.equal(sameWord('le bus', ''), false);
  assert.equal(sameWord('', ''), false);
});

test('a short form is graded on the letter: où is not ou, and dû is not du', () => {
  /* With the ordinary tolerance every one of these came back "accent", which
     is a Good: the accent is the whole difference between two words. */
  assert.equal(checkCloze('ou', 'où').verdict, 'no');
  assert.equal(checkCloze('a', 'à').verdict, 'no');
  assert.equal(checkCloze('du', 'dû').verdict, 'no');
  assert.equal(checkCloze('des', 'dès').verdict, 'no');
  assert.equal(checkCloze('Où', 'où').verdict, 'ok', 'case is the one thing forgiven');
  assert.equal(checkCloze('etes', 'êtes').verdict, 'accent', 'a longer form keeps the note');
});

test('an answer from a closed set is strict: sans is not dans, serai is not serais', () => {
  /* Measured before this was written: a card about the ending could not fail
     a learner who got the ending wrong, because one letter is "close". */
  assert.equal(checkCloze('sans', 'dans').verdict, 'close', 'the ordinary rule');
  assert.equal(checkCloze('sans', 'dans', { strict: true }).verdict, 'no');
  assert.equal(checkCloze('serai', 'serais', { strict: true }).verdict, 'no');
  assert.equal(checkCloze('etais', 'étais', { strict: true }).verdict, 'no', 'no accent forgiven');
  assert.equal(checkCloze('dans', 'dans', { strict: true }).verdict, 'ok');
  assert.equal(checkCloze('Dans', 'dans', { strict: true }).verdict, 'ok');
});

test('a tapped option is right or wrong, nothing in between', () => {
  assert.equal(checkChoice('sur', 'sur').verdict, 'ok');
  assert.equal(checkChoice('sous', 'sur').verdict, 'no');
  assert.equal(checkChoice(null, 'sur').verdict, 'no');
  assert.equal(ratingFor(checkChoice('sous', 'sur').verdict), 1, 'a wrong tap is an Again');
});

test('a spelling within a typo of another is a near miss, the same word is not', () => {
  /* What the connector flags before it writes: a lesson's "chaussete" beside
     the list's "la chaussette" is one word twice, not a new word. */
  assert.equal(nearMiss('le chaussete', 'la chaussette'), true);
  assert.equal(nearMiss('acueil', "l'accueil"), true);
  /* Swapping two letters is two edits, which a seven-letter word is not
     allowed: the tolerance is the grading's, and grading would not pass it. */
  assert.equal(nearMiss('acceuil', "l'accueil"), false);
  assert.equal(nearMiss('la chaussette', 'chaussette'), false, 'the same word is not a miss');
  assert.equal(nearMiss('le pont', 'le port'), true, 'one letter apart, whatever the words');
  assert.equal(nearMiss('le bus', 'le train'), false);
  assert.equal(nearMiss('', 'le train'), false);
});
