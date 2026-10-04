import { test } from 'vitest';
import assert from 'node:assert/strict';
import { VERBS } from '../src/lib/essentials.js';
import { PAGE, SENTENCES, SIZES, exercise, gapOf, mark, page, wholeOf } from '../src/lib/essentialsbook.js';

test('every verb on the sheet has sentences in the present and the passé composé', () => {
  for (const v of VERBS) {
    const mine = SENTENCES.filter((s) => s.verb === v.inf);
    assert.ok(mine.filter((s) => s.tense === 'pres').length >= 4, `${v.inf} needs present sentences`);
    assert.ok(mine.some((s) => s.tense === 'pc'), `${v.inf} needs a passé composé sentence`);
  }
});

test('a present gap is a form of its own verb, and a passé composé gap is its participle', () => {
  /* A sentence typed by hand with the wrong form in its braces would mark
     the right answer wrong. */
  for (const s of SENTENCES) {
    const v = VERBS.find((x) => x.inf === s.verb);
    assert.ok(v, `${s.fr}: no verb ${s.verb}`);
    for (const form of gapOf(s).forms) {
      if (s.tense === 'pres') assert.ok(v.present.includes(form), `${s.fr}: ${form} is not ${v.inf}`);
      else assert.ok(form.startsWith(v.pp), `${s.fr}: ${form} is not ${v.pp}, agreed or not`);
    }
  }
});

test('a sentence with a choice of forms accepts each as a whole translation', () => {
  const s = SENTENCES.find((x) => x.fr.startsWith('Nous sommes {'))!;
  assert.deepEqual(wholeOf(s), ['Nous sommes allés au parc.', 'Nous sommes allées au parc.']);
});

test('the same seed deals the same page, and a page has every kind', () => {
  const a = page({ seed: 7 });
  const b = page({ seed: 7 });
  assert.deepEqual(a.map((e) => e.items.map((i) => i.id)), b.map((e) => e.items.map((i) => i.id)));
  assert.deepEqual(a.map((e) => e.kind), [...PAGE]);
  for (const ex of a) {
    if (ex.kind !== 'table') assert.equal(ex.items.length, SIZES[ex.kind], ex.kind);
    assert.equal(new Set(ex.items.map((i) => i.id)).size, ex.items.length, `${ex.kind} repeats an item`);
  }
});

test('a whole table is six persons and the participle', () => {
  const ex = exercise('table', { seed: 1, verbs: ['boire'] });
  assert.deepEqual(ex.items.map((i) => i.shown), ['bois', 'bois', 'boit', 'buvons', 'buvez', 'boivent', 'bu']);
  assert.deepEqual(ex.items.map((i) => i.heard.text).slice(0, 4), ['je bois', 'tu bois', 'il boit', 'nous buvons']);
});

test('a page held to some verbs asks only about them', () => {
  for (const ex of page({ seed: 3, verbs: ['être', 'avoir', 'aller'] })) {
    for (const item of ex.items) {
      assert.ok(/être|avoir|aller|été|eu|allé|^gap|^tr/.test(item.id) || ['été', 'eu', 'allé'].includes(item.shown),
        `${ex.kind}: ${item.id}`);
    }
  }
  const pres = exercise('present', { seed: 3, verbs: ['être'] });
  assert.ok(pres.items.every((i) => i.heard.text.match(/suis|es|est|sommes|êtes|sont/)));
});

test('an exercise is marked item by item: right, wrong, or left empty', () => {
  const ex = exercise('table', { seed: 1, verbs: ['être'] });
  const { marks, right } = mark(ex, ['je suis', 'es', 'est', 'sommes', 'etes', '', 'été']);
  assert.deepEqual(marks.map((m) => m.state), ['right', 'right', 'right', 'right', 'wrong', 'empty', 'right']);
  assert.equal(right, 5);
  assert.equal(marks[4]!.against, 'êtes');
  assert.equal(marks[4]!.typed, 'etes');
});

test('a translation is right in any of its accepted wordings, and spelling counts', () => {
  const ex = exercise('translate', { seed: 11 });
  const answers = ex.items.map((i) => i.accepted.at(-1)!);
  assert.equal(mark(ex, answers).right, ex.items.length);
  const s = SENTENCES.find((x) => x.fr === 'Vous {êtes} français ?')!;
  const one = { kind: 'translate' as const, title: '', instruction: '',
    items: [{ ...exercise('translate', { seed: 0 }).items[0]!, accepted: wholeOf(s) }] };
  assert.equal(mark(one, ['vous etes français']).marks[0]!.state, 'wrong');
  assert.equal(mark(one, ['Êtes-vous français']).marks[0]!.state, 'right');
});
