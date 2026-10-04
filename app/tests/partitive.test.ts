/** The de / du / des drills: some of a thing, the thing in general, and
 *  de alone after a quantity or a negation — each a closed list of short
 *  sentences with a gap.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { candidatesFor, dealRules, instanceForId, madeFrom } from '../src/lib/grammar/deal.js';
import { answerCells } from '../src/lib/grammar/instance.js';
import { LESSONS } from '../src/lib/grammar/lessons/index.js';
import { PASS_BREADTH } from '../src/lib/grammar/derive.js';
import { AMOUNT_BANK, filled, GAP, partitiveFor, partitivesFor, SOME_BANK } from '../src/lib/grammar/partitive.js';

test('du pain, de la soupe, de l’eau, des pommes: tapped among the four, the gap marked in the sentence', () => {
  const ex = partitivesFor('D.art-indef');
  const eau = ex.find((i) => i.id === 'partitive:D.art-indef:eau');
  assert.ok(eau);
  assert.equal(eau.face, 'choose');
  assert.equal(eau.sentence?.f, GAP, 'the gap is what the card marks');
  assert.equal(eau.hint, 'Do you want some water?');
  assert.deepEqual(eau.cells[0]?.options, ['du', 'de la', "de l'", 'des']);
  assert.equal(eau.cells[0]?.expected, "de l'");
  assert.equal(eau.speech?.text, "Tu veux de l'eau ?", 'de l’ runs into the word after it when said');
  assert.equal(answerCells(eau, ["de l'"])[0]?.ok, true);
  assert.equal(answerCells(eau, ['de la'])[0]?.ok, false);
});

test('j’aime le café but je bois du café: the thing in general against some of it', () => {
  const ex = partitivesFor('D.art-indef');
  const aime = ex.find((i) => i.id === 'partitive:D.art-indef:aime-cafe');
  const bois = ex.find((i) => i.id === 'partitive:D.art-indef:bois-cafe');
  assert.equal(aime?.cells[0]?.expected, 'le');
  assert.equal(bois?.cells[0]?.expected, 'du');
  assert.deepEqual(aime?.cells[0]?.options, bois?.cells[0]?.options, 'the same two to choose between');
});

test('beaucoup de café, beaucoup d’amis, la plupart des gens: typed, and mixed with du and pas de so that de is not always the answer', () => {
  const ex = partitivesFor('D.de-quantity');
  assert.ok(ex.every((i) => i.face === 'gap' && !i.cells[0]?.options), 'typed, not tapped');
  const answers = new Set(ex.map((i) => i.cells[0]?.expected));
  for (const a of ['de', "d'", 'du', 'de la', 'des']) assert.ok(answers.has(a), a);
  const amis = ex.find((i) => i.id === 'partitive:D.de-quantity:beaucoup-amis')!;
  assert.equal(amis.speech?.text, "Tu as beaucoup d'amis.");
  assert.equal(answerCells(amis, ['d’'])[0]?.ok, true, 'a curly apostrophe is the same answer');
  assert.equal(answerCells(amis, ['des'])[0]?.ok, false);
});

test('a sentence decided by the negation or by some-of is evidence about that rule too', () => {
  const pas = partitiveFor(AMOUNT_BANK.find((s) => s.id === 'pas-viande')!, 'D.de-quantity');
  assert.deepEqual(pas.cells[0]?.obs.map((o) => o.of), ['D.de-quantity', 'D.de-negative']);
  const kilo = partitiveFor(AMOUNT_BANK.find((s) => s.id === 'kilo-tomates')!, 'D.de-quantity');
  assert.deepEqual(kilo.cells[0]?.obs.map((o) => o.of), ['D.de-quantity']);
});

test('every sentence in the banks has one gap, a key among its options, and an id of its own', () => {
  for (const bank of [SOME_BANK, AMOUNT_BANK]) {
    assert.equal(new Set(bank.map((s) => s.id)).size, bank.length);
    assert.ok(bank.length >= PASS_BREADTH * 2, 'enough sentences to pass on and still be asked fresh ones');
    for (const s of bank) {
      assert.equal(s.fr.split(GAP).length, 2, s.fr);
      if (s.options) assert.ok(s.options.includes(s.answer), s.id);
      assert.ok(!filled(s.fr, s.answer).includes(GAP), s.id);
      assert.ok(!/' /.test(filled(s.fr, s.answer).replace(/s'il vous/, '')), `${s.id}: no space after an apostrophe`);
    }
  }
});

test('the drills are made from nothing the learner has, dealt, made again from their id, and each has a lesson', () => {
  for (const rule of ['D.art-indef', 'D.de-quantity'] as const) {
    assert.equal(madeFrom(rule), 'nothing');
    assert.ok(LESSONS[rule], `${rule} has a lesson`);
    const all = candidatesFor(rule, []);
    assert.equal(all.length, partitivesFor(rule).length);
    for (const i of all) assert.deepEqual(instanceForId(i.id, null), i);
  }
  const dealt = dealRules({ due: ['D.art-indef', 'D.de-quantity'], verbs: [], cards: [], attempts: [], limit: 5 });
  assert.deepEqual(dealt.map((d) => d.instance.rule), ['D.art-indef', 'D.de-quantity']);
  assert.equal(instanceForId('partitive:D.art-indef:no-such', null), null);
  assert.equal(instanceForId('partitive:Not.a-rule:pain', null), null);
});
