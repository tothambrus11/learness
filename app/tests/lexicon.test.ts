/** Any French word on a screen, taken apart so it can be looked up. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { bases, tokens } from '../src/lib/lexicon.js';

test('a line is cut into the words a learner would point at, and joins back into the line', () => {
  const line = "J’appelle ma mère, peux-tu ? A-t-il vu aujourd'hui mes grands-parents…";
  const got = tokens(line);
  assert.equal(got.map((t) => t.text).join(''), line, 'nothing lost or added');
  assert.deepEqual(got.filter((t) => t.look).map((t) => [t.text, t.look]), [
    ['J’', 'je'], ['appelle', 'appelle'], ['ma', 'ma'], ['mère', 'mère'], ['peux', 'peux'], ['tu', 'tu'],
    ['A', 'a'], ['il', 'il'], ['vu', 'vu'], ["aujourd'hui", "aujourd'hui"], ['mes', 'mes'],
    ['grands-parents', 'grands-parents'],
  ]);
  assert.deepEqual(tokens("l'école").map((t) => t.look), ['le', 'école'], 'an elided article is the article');
  assert.deepEqual(tokens(''), []);
});

test('a form is offered every headword it could be, the right one among them', () => {
  /* Each row: the form, and the headword (and part of speech) that must be
     among the guesses. The guesses are checked against the dictionary
     before anything is shown; a guess missing is a word that cannot be
     looked up. */
  const table: [string, string, string | null][] = [
    ['mère', 'mère', null],
    ['appelle', 'appeler', 'verb'], ['jette', 'jeter', 'verb'], ['lève', 'lever', 'verb'],
    ['préfère', 'préférer', 'verb'], ['mangeons', 'manger', 'verb'], ['commençons', 'commencer', 'verb'],
    ['paie', 'payer', 'verb'], ['parlé', 'parler', 'verb'], ['parlées', 'parler', 'verb'],
    ['finissons', 'finir', 'verb'], ['fini', 'finir', 'verb'], ['vendu', 'vendre', 'verb'],
    ['vendrai', 'vendre', 'verb'], ['parlerions', 'parler', 'verb'], ['parlait', 'parler', 'verb'],
    ['chevaux', 'cheval', 'noun'], ['bateaux', 'bateau', 'noun'], ['clés', 'clé', 'noun'],
    ['bonne', 'bon', 'adj'], ['heureuse', 'heureux', 'adj'], ['heureuses', 'heureux', 'adj'],
    ['nouvelle', 'nouveau', null], ['mes', 'mon', null], ['leurs', 'leur', null], ['les', 'le', null],
  ];
  for (const [form, lemma, pos] of table) {
    const got = bases(form);
    assert.ok(got.some((b) => b.lemma === lemma && (pos === null || b.pos === pos || b.pos === null)),
      `${form} → ${lemma}: ${got.slice(0, 8).map((b) => b.lemma).join(', ')}`);
  }
  assert.deepEqual(bases('Mère')[0], { lemma: 'mère', pos: null, via: '' }, 'the form itself first, in lower case');
  assert.equal(bases('appelle').find((b) => b.lemma === 'appeler')?.via, 'a form of');
  assert.equal(bases('chevaux').find((b) => b.lemma === 'cheval')?.via, 'plural of');
  assert.deepEqual(bases(' '), []);
});
