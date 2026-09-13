/** A verb form, as it is said.
 *
 *  The rule is short because the pipeline already elides the pronouns and
 *  carries the subjunctive's "que". What is left is the imperative, whose
 *  pronoun is in brackets because it is not spoken at all.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  CORE_TENSES, FIRST_TENSES, conjSlot, phrasesOf, phrasesOfGroup, spokenForm,
} from '../src/lib/conjspeech.js';
import type { Conjugation, ConjugationGroup, ConjugationRow } from '../src/lib/model.js';

const row = (p: string, f: string): ConjugationRow =>
  ({ p, f, s: '', e: f, alt: false, dup: false });

const group = (id: string, rows: ConjugationRow[]): ConjugationGroup =>
  ({ id, mood: 'Indicatif', tense: id, stem: '', irregular: false, note: '', rows });

const conj = (groups: ConjugationGroup[]): Conjugation => ({
  lemma: 'parler', aux: 'avoir', shape: 'regular -er', groups,
  compound: [], impersonal: [], links: [], examples: {},
});

test('a form is said with its pronoun, which is what makes it French', () => {
  assert.equal(spokenForm(row('je', 'parle')), 'je parle');
  assert.equal(spokenForm(row('ils', 'parlent')), 'ils parlent');
  assert.equal(spokenForm(row('que je', 'parle')), 'que je parle');
});

test('an elided pronoun runs into its verb, with no space in between', () => {
  assert.equal(spokenForm(row("j'", 'étais')), "j'étais");
  assert.equal(spokenForm(row("qu'il", 'soit')), "qu'il soit");
  assert.equal(spokenForm(row('j’', 'aime')), 'j’aime', 'the curly apostrophe too');
});

test('the imperative’s pronoun is written, not said', () => {
  /* "(tu) sois" is how the table says that the form stands alone. */
  assert.equal(spokenForm(row('(tu)', 'sois')), 'sois');
  assert.equal(spokenForm(row('(vous)', 'soyez')), 'soyez');
});

test('a row with nothing in it is said as nothing', () => {
  assert.equal(spokenForm(null), '');
  assert.equal(spokenForm(row('je', '')), '');
  assert.equal(spokenForm(row('', 'parle')), 'parle', 'a form with no pronoun is still a form');
});

test('every line of a tense gets a slot of its own, by its place in it', () => {
  const phrases = phrasesOfGroup('parler|verb', group('pres', [row('je', 'parle'), row('tu', 'parles')]));
  assert.deepEqual(phrases, [
    { key: 'parler|verb', slot: 'conj:pres:0', text: 'je parle' },
    { key: 'parler|verb', slot: 'conj:pres:1', text: 'tu parles' },
  ]);
  assert.equal(conjSlot('imp', 3), 'conj:imp:3');
});

test('only the tenses asked for are prepared', () => {
  const table = conj([
    group('pres', [row('je', 'parle')]),
    group('imp', [row('je', 'parlais')]),
    group('pqp', [row('je', 'parlasse')]),
  ]);
  assert.equal(phrasesOf('parler|verb', table).length, 3, 'all of them by default');
  assert.deepEqual(phrasesOf('parler|verb', table, FIRST_TENSES).map((p) => p.text),
    ['je parle']);
  assert.deepEqual(phrasesOf('parler|verb', table, CORE_TENSES).map((p) => p.text),
    ['je parle', 'je parlais'], 'the literary tense is not made on a guess');
  assert.deepEqual(phrasesOf('parler|verb', null), [], 'a word that is not a verb has none');
});
