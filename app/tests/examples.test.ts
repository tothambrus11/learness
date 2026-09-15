import { test } from 'vitest';
import assert from 'node:assert/strict';
import { examplesFor, findForm, pickableTenses, splitOnForm, standsIn, timed, untimed }
  from '../src/lib/examples.js';

test('the matched form is found as a whole word, after an apostrophe too', () => {
  assert.deepEqual(splitOnForm("J'ai mangé.", 'ai mangé'), ["J'", 'ai mangé', '.']);
  assert.deepEqual(splitOnForm('Allons-y doucement.', 'allons'), ['', 'Allons', '-y doucement.']);
  assert.deepEqual(splitOnForm('Il faut que je mange.', 'mange'), ['Il faut que je ', 'mange', '.']);
});

test('a form inside another word is not highlighted', () => {
  assert.deepEqual(splitOnForm('Elle mangeait.', 'mange'), ['Elle mangeait.', '', '']);
});

test('a gap never falls inside a hyphenated word: Peut-être is not être', () => {
  /* The rule for the cloze and for the highlight is the one finder. Before
     it, "Peut-être pas." was dealt as "Peut-___ pas." for être, and
     "Les sous-titres sont faux." as "Les sous-___ …" for titre (#39). */
  assert.deepEqual(splitOnForm('Peut-être pas.', 'être'), ['Peut-être pas.', '', '']);
  assert.deepEqual(splitOnForm('Les sous-titres sont faux.', 'titres'),
    ['Les sous-titres sont faux.', '', '']);
  assert.deepEqual(splitOnForm('Regarde là-haut.', 'haut'), ['Regarde là-haut.', '', '']);
  /* The second être stands alone, and it is the one found. */
  assert.deepEqual(findForm('Peut-être pas, je veux être là.', 'être'), { start: 23, end: 27 });
  /* A hyphen after the form is a real boundary, as it always was. */
  assert.deepEqual(splitOnForm('Dit-il vraiment ?', 'dit'), ['', 'Dit', '-il vraiment ?']);
  assert.equal(standsIn({ fr: 'Faisons demi-tour.', f: 'tour' }), false);
  assert.equal(standsIn({ fr: 'Le tour est joué.', f: 'tour' }), true);
  assert.equal(findForm('Il pleut.', ''), null);
});

test('examples come from the shipped table, with a source only when there are some', () => {
  const conj = { examples: { pres: [{ fr: 'Je mange ici.', en: 'I eat here.', f: 'mange' }] } };
  assert.equal(examplesFor(conj, 'pres').examples.length, 1);
  assert.match(examplesFor(conj, 'pres').source, /Tatoeba/);
  assert.deepEqual(examplesFor(conj, 'subj'), { examples: [], source: '' });
  assert.deepEqual(examplesFor(undefined, 'subj').examples, []);
});

test('a sentence that says when — hier, demain, souvent — is timed; one that does not is not', () => {
  /* A time word answers before the ending is read, and the ending is never
     learned. So a which-time card is dealt only the sentences without one. */
  assert.equal(timed({ fr: 'Hier il pleuvait.' }), true);
  assert.equal(timed({ fr: 'Je pars demain.' }), true);
  assert.equal(timed({ fr: "L'année dernière, nous sommes allés en Italie." }), true);
  assert.equal(timed({ fr: 'Il y a trois ans, elle habitait ici.' }), true);
  assert.equal(timed({ fr: 'Il pleuvait.' }), false);
  assert.equal(timed({ fr: 'Elle a fermé la porte.' }), false);
  assert.equal(timed({ fr: 'Demande à Alex.' }), false, '"demande" is not "demain"');
});

test('the which-time pool is the untimed, surely-matched sentences of each tense', () => {
  const conj = { examples: {
    pc: [{ fr: 'Hier, il a plu.', en: '', f: 'a plu' }, { fr: 'Il a plu.', en: '', f: 'a plu' }],
    imp: [{ fr: 'Il pleuvait.', en: '', f: 'pleuvait' }],
    fut: [{ fr: 'Il pleuvra.', en: '', f: 'pleuvra', ctx: true }],
  } };
  assert.deepEqual(untimed(conj.examples.pc).map((e) => e.fr), ['Il a plu.']);
  assert.deepEqual(pickableTenses(conj), ['pc', 'imp'], 'the futur was found by context, so it is out');
  assert.deepEqual(pickableTenses({ examples: {} }), []);
  assert.deepEqual(pickableTenses(null), []);
});
