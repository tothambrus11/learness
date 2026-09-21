/** The pattern drills: which time, the order of a negation's pieces,
 *  which forms sound alike, what an ending predicts, the French compounds
 *  read.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { answerCells, joinPieces, markPieces } from '../src/lib/grammar/instance.js';
import { endingsFor, frenchTensWhichFor, negCompoundFor, negInfinitiveFor, patternCandidates, patternsFor,
  soundAlikeFor, whichTimesFor } from '../src/lib/grammar/patterns.js';
import type { Conjugation } from '../src/lib/model.js';
import { word } from './make.js';

const pron = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];
const parler: Conjugation = {
  lemma: 'parler', aux: 'avoir', shape: '', impersonal: [], links: [],
  groups: [{ id: 'pres', mood: '', tense: 'Présent', stem: 'parl', irregular: false, note: '',
    rows: ['e', 'es', 'e', 'ons', 'ez', 'ent'].map((e, i) => ({ p: pron[i]!, s: 'parl', e, f: `parl${e}` })) }],
  compound: [{ id: 'pc', label: 'Passé composé', aux: 'avoir', aux_key: 'pres', aux_form: 'ai', participle: 'parlé',
    example: '', why: '', agrees: false }],
  examples: {
    pc: [{ fr: 'Elle a parlé au directeur.', f: 'a parlé', en: 'She spoke to the manager.', id: 1002 }],
    imp: [{ fr: 'Il parlait doucement.', f: 'parlait', en: 'He was speaking softly.', id: 1003 }],
  },
};
const v = word({ k: 'parler|verb', fr: 'parler', lemma: 'parler', pos: 'verb', en: ['to speak'], conj: parler });

test('which time: a sentence in the passé composé or the imparfait, the two times to tap, and no English to give it away', () => {
  const [pc, imp] = whichTimesFor(v);
  assert.equal(pc?.id, 'sentence:parler|verb:1002:V.pc-vs-imp');
  assert.equal(pc?.face, 'which');
  assert.equal(pc?.hint, '');
  assert.equal(pc?.sentence?.fr, 'Elle a parlé au directeur.');
  assert.deepEqual(pc?.cells[0]?.options, ['it happened — done, once, over', 'it was going on, or used to happen']);
  assert.equal(pc?.cells[0]?.expected, 'it happened — done, once, over');
  assert.equal(imp?.cells[0]?.expected, 'it was going on, or used to happen');
});

test('the pieces of je ne veux pas partir and je n’ai pas parlé, shuffled by the verb and never left in order', () => {
  const inf = negInfinitiveFor(v);
  assert.ok(inf);
  const modal = (inf.spec as { modal: string }).modal;
  assert.ok(['veux', 'peux', 'dois'].includes(modal), 'one modal, picked by the verb');
  assert.equal(inf.cells[0]?.expected, `je ne ${modal} pas parler`);
  assert.deepEqual([...inf.cells[0]?.pieces ?? []].sort(), ['je', modal, 'ne', 'parler', 'pas'].sort());
  assert.notDeepEqual(inf.cells[0]?.pieces, ['je', 'ne', modal, 'pas', 'parler'], 'never in order');
  assert.match(inf.title, /^I (don't want to|can't|don't have to) speak$/, 'the English says what to build');
  assert.equal(negInfinitiveFor(v)?.cells[0]?.expected, inf.cells[0]?.expected, 'the same on every device');
  const pc = negCompoundFor(v);
  assert.equal(pc?.cells[0]?.expected, "je n'ai pas parlé", 'no space after the apostrophe');
  assert.equal(joinPieces(['je', "n'", 'ai', 'pas', 'parlé']), "je n'ai pas parlé");
  assert.equal(pc?.title, 'I did not speak');
  const etre = negCompoundFor(word({ k: 'partir|verb', en: ['to leave'], conj: { ...parler, lemma: 'partir',
    compound: [{ ...parler.compound[0]!, aux: 'être', aux_form: 'suis', participle: 'parti', agrees: true }] } }));
  assert.equal(etre?.cells[0]?.expected, 'je ne suis pas parti');
  assert.equal(negCompoundFor(word({ k: 'bug|noun' })), null);
  /* Answered in the wrong order it is wrong; tapped right it is right. */
  assert.equal(answerCells(inf, [`je ${modal} ne pas parler`])[0]?.ok, false);
  assert.equal(answerCells(inf, [`je ne ${modal} pas parler`])[0]?.ok, true);
});

test('which forms sound like je parle: the silent endings, and only those', () => {
  const m = soundAlikeFor(v);
  assert.ok(m);
  assert.equal(m.face, 'mark');
  assert.equal(m.cells[0]?.multi, true);
  assert.deepEqual(m.cells[0]?.pieces, ['je parle', 'tu parles', 'il parle', 'nous parlons', 'vous parlez', 'ils parlent']);
  assert.equal(m.cells[0]?.expected, 'je parle · tu parles · il parle · ils parlent');
  assert.equal(markPieces(m.cells[0]?.pieces ?? [], ['ils parlent', 'je parle']), 'je parle · ils parlent',
    'in the pieces’ order, whatever order they were tapped');
  assert.equal(answerCells(m, ['je parle · tu parles · il parle · ils parlent'])[0]?.ok, true);
  assert.equal(answerCells(m, ['je parle · il parle'])[0]?.ok, false, 'two left out');
  assert.equal(soundAlikeFor(word({ k: 'finir|verb', conj: { ...parler, lemma: 'finir' } })), null, 'an -er verb only');
});

test('an ending predicts a gender, and the French compounds are read among three numbers', () => {
  const endings = endingsFor();
  assert.ok(endings.length >= 10);
  const tion = endings.find((e) => e.id === 'ending:tion');
  assert.equal(tion?.title, '-tion');
  assert.equal(tion?.cells[0]?.expected, 'feminine');
  assert.deepEqual(tion?.cells[0]?.options, ['masculine', 'feminine']);
  const f = frenchTensWhichFor(81);
  assert.equal(f.title, 'quatre-vingt-un');
  assert.equal(f.cells[0]?.expected, '81');
  assert.equal(f.cells[0]?.options?.length, 3);
  assert.ok(f.cells[0]?.options?.includes('81'));
  assert.deepEqual(frenchTensWhichFor(81).cells[0]?.options, f.cells[0]?.options, 'the same every time');
});

test('the pattern candidates come from the learner’s verbs, or from the rule’s own list', () => {
  assert.equal(patternCandidates('V.pc-vs-imp', [v], 'ch').length, 2);
  assert.equal(patternCandidates('G.pas-infinitive', [v], 'ch').length, 1);
  assert.equal(patternCandidates('D.gender-endings', [], 'ch').length, endingsFor().length);
  assert.equal(patternCandidates('N.french-tens', [], 'ch').length, 12);
  assert.deepEqual(patternCandidates('G.pas', [v], 'ch'), []);
  assert.deepEqual(patternsFor(v).map((i) => i.id), ['sentence:parler|verb:1002:V.pc-vs-imp',
    'sentence:parler|verb:1003:V.pc-vs-imp', 'order:parler|verb:G.pas-infinitive', 'order:parler|verb:G.pas-compound',
    'mark:parler|verb:P.verb-endings']);
});
