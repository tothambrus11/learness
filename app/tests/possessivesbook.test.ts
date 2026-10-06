import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mark } from '../src/lib/essentialsbook.js';
import { NOUNS, TABLE, owned } from '../src/lib/possessives.js';
import { BOOK_KEY, PAGE, SENTENCES, SIZES, exercise, page, pagePhrases, wholeOf } from '../src/lib/possessivesbook.js';
import { gapOf } from '../src/lib/essentialsbook.js';

test('every sentence’s gap is a form from its owner’s row, and the right one where the noun follows', () => {
  /* A sentence typed by hand with the wrong form in its braces would mark
     the right answer wrong. */
  for (const s of SENTENCES) {
    const { forms, after } = gapOf(s);
    const form = forms[0]!.toLowerCase();
    assert.ok(TABLE[s.owner]!.includes(form), `${s.fr}: ${form} is not ${TABLE[s.owner]!.join('/')}`);
    const next = after.trim().split(/[\s.,?!]/)[0] ?? '';
    const n = NOUNS.find((x) => x.fr === next);
    if (n) assert.equal(`${form} ${n.fr}`, owned(s.owner, n), s.fr);
  }
});

test('the same seed deals the same page, and a page has every kind once, with no item twice', () => {
  const a = page(7);
  assert.deepEqual(a.map((e) => e.items.map((i) => i.id)), page(7).map((e) => e.items.map((i) => i.id)));
  assert.deepEqual(a.map((e) => e.kind), [...PAGE]);
  for (const ex of a) {
    if (ex.kind !== 'table') assert.equal(ex.items.length, SIZES[ex.kind], ex.kind);
    assert.equal(new Set(ex.items.map((i) => i.id)).size, ex.items.length, `${ex.kind} repeats an item`);
    for (const item of ex.items) assert.ok(item.accepted.includes(item.shown), `${item.id}: shows what it accepts`);
  }
});

test('the first drills keep mon amie out: the column is the gender until the vowel is taught', () => {
  for (let seed = 0; seed < 40; seed++) {
    for (const kind of ['agree', 'hisher'] as const) {
      for (const item of exercise(kind, seed).items) {
        assert.ok(!(['mon', 'ton', 'son'].includes(item.shown) && /^(amie|école|idée|adresse|histoire)/.test(item.after)),
          `${kind}: ${item.shown} ${item.after}`);
      }
    }
  }
});

test('his or her: the answer follows the noun, whichever owner the English names', () => {
  for (let seed = 0; seed < 20; seed++) {
    for (const item of exercise('hisher', seed).items) {
      const n = NOUNS.find((x) => x.fr === item.after)!;
      assert.equal(item.shown, n.plural ? 'ses' : n.gender === 'f' ? 'sa' : 'son', item.cue);
    }
  }
});

test('the vowel drill is half before a vowel and half not, all feminine', () => {
  const ex = exercise('vowel', 3);
  const borrowed = ex.items.filter((i) => ['mon', 'ton', 'son'].includes(i.shown)).length;
  assert.equal(borrowed, SIZES.vowel / 2);
});

test('changing owner goes across the table: je to nous, and the gender is lost', () => {
  for (const item of exercise('owners', 5).items) {
    const [, from] = item.id.split('|');
    const to = (Number(from) + 3) % 6;
    assert.ok(TABLE[to]!.includes(item.shown), `${item.id} → ${item.shown}`);
  }
});

test('the whole table is eighteen cells, the plural owners answered for both genders', () => {
  const ex = exercise('table', 1);
  assert.equal(ex.items.length, 18);
  assert.deepEqual(ex.items.slice(0, 3).map((i) => i.shown), ['mon', 'ma', 'mes']);
  assert.deepEqual(ex.items.slice(9, 12).map((i) => i.shown), ['notre', 'notre', 'nos']);
  assert.deepEqual(ex.items.slice(15).map((i) => i.shown), ['leur', 'leur', 'leurs']);
});

test('the her-father trap is marked wrong, and a capital at the start of a sentence is not', () => {
  /* "her father": the instinct is sa, for her. */
  const hisher = [0, 1, 2, 3, 4, 5].map((seed) => exercise('hisher', seed))
    .find((ex) => ex.items.some((i) => i.shown === 'son' && i.cue.startsWith('her ')))!;
  const at = hisher.items.findIndex((i) => i.shown === 'son' && i.cue.startsWith('her '));
  const typed = hisher.items.map((i) => i.shown);
  typed[at] = 'sa';
  const { marks } = mark(hisher, typed);
  assert.equal(marks[at]!.state, 'wrong');
  assert.equal(marks.filter((m) => m.state === 'right').length, hisher.items.length - 1);
  const s = SENTENCES.find((x) => x.fr.startsWith('{Notre} fils'))!;
  const item = { ...exercise('context', 0).items[0]!, accepted: gapOf(s).forms };
  assert.equal(mark({ items: [item] }, ['notre']).marks[0]!.state, 'right');
});

test('a translation is right in any of its wordings', () => {
  const s = SENTENCES.find((x) => x.fr === "C'est {ta} voiture ?")!;
  assert.deepEqual(wholeOf(s).slice(0, 2), ["C'est ta voiture ?", 'Est-ce ta voiture ?']);
  const ex = exercise('translate', 11);
  assert.equal(mark(ex, ex.items.map((i) => i.accepted.at(-1)!)).right, ex.items.length);
});

test('a page prepares what each of its items will say once checked, each once', () => {
  /* Made as the page opens, behind the table (#109). */
  const ex = page(7);
  const phrases = pagePhrases(ex);
  const heard = new Set(ex.flatMap((e) => e.items.map((i) => i.heard.slot)));
  assert.equal(phrases.length, heard.size);
  assert.ok(phrases.every((p) => p.key === BOOK_KEY && heard.has(p.slot)));
});
