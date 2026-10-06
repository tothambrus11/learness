import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mark } from '../src/lib/essentialsbook.js';
import { NOUNS, TABLE, owned } from '../src/lib/possessives.js';
import { BOOK_KEY, PAGE, SENTENCES, SIZES, exercise, nounOf, nounsOf, page, pagePhrases, wholeOf } from '../src/lib/possessivesbook.js';
import { word } from './make.js';
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

const noun = (fr: string, en: string, gender: 'm' | 'f', number: '' | 'pl' = '') =>
  word({ k: `${fr}|noun`, fr, en: [en], pos: 'noun', gender, number });

test('a studied word becomes a noun of the sheet: no article, its first sense, its gender, an aspirated h read off le', () => {
  assert.deepEqual(nounOf(noun('la voiture', 'the car; automobile', 'f')),
    { fr: 'voiture', en: 'car', gender: 'f', plural: false, aspirated: false, family: false });
  assert.equal(nounOf(noun("l'école", 'school', 'f'))?.fr, 'école');
  assert.equal(nounOf(noun('le héros', 'hero', 'm'))?.aspirated, true, 'le héros: the h is said');
  assert.equal(nounOf(noun("l'homme", 'man', 'm'))?.aspirated, false);
  assert.equal(nounOf(noun('les gens', 'people', 'm', 'pl'))?.plural, true);
  assert.equal(nounOf(noun('le/la ministre', 'minister', 'm')), null, 'a pair form is not one noun');
  assert.equal(nounOf({ ...noun('le prof', 'teacher', 'm'), gender: 'mf' }), null, 'either gender: no column');
  assert.equal(nounOf({ ...noun('aller', 'go', 'm'), pos: 'verb' }), null);
  assert.equal(nounOf({ ...noun('le truc', '', 'm'), en: [] }), null, 'nothing to gloss it with');
  assert.deepEqual(nounsOf([noun('le chat', 'cat', 'm'), noun('le chat', 'tomcat', 'm')]).map((n) => n.en), ['cat'],
    'each spelling once');
});

test('the drills on a noun take the nouns you have studied first, and leave room for the sheet’s own', () => {
  /* The exercises were all the sheet's own nouns, whatever had been
     studied (#110). */
  const studied = nounsOf([
    noun('la voiture', 'car', 'f'), noun('le jardin', 'garden', 'm'), noun('la table', 'table', 'f'),
    noun('le stylo', 'pen', 'm'), noun('la porte', 'door', 'f'), noun('le pont', 'bridge', 'm'),
    noun('la rue', 'street', 'f'), noun('le train', 'train', 'm'), noun('la nation', 'nation', 'f'),
    noun('les clés', 'keys', 'f', 'pl'),
  ]);
  const mine = new Set(studied.map((n) => n.fr));
  for (const seed of [1, 2, 3]) {
    const agree = exercise('agree', seed, studied);
    const taken = agree.items.filter((i) => mine.has(i.after)).length;
    assert.ok(taken >= SIZES.agree - Math.floor(SIZES.agree / 4), `three in four from the studied, at least: ${taken}`);
    assert.ok(agree.items.some((i) => !mine.has(i.after)), 'and room for one of the sheet’s own');
    assert.equal(new Set(agree.items.map((i) => i.id)).size, agree.items.length, 'no item twice');
  }
  const owners = [1, 2, 3, 4].map((s) => exercise('owners', s, studied).items.map((i) => i.after).join());
  assert.ok(new Set(owners).size > 1, 'a re-deal is a different choice');
  const table = exercise('table', 5, studied);
  assert.ok(table.items.every((i) => mine.has(i.after)), 'one of each column from the studied, where there is one');
  /* Too few studied: the sheet's own fill in. */
  const two = studied.slice(0, 2);
  const few = exercise('agree', 1, two);
  assert.equal(few.items.length, SIZES.agree);
  assert.deepEqual(few.items.filter((i) => two.some((n) => n.fr === i.after)).length, 2, 'both of them, and the bank for the rest');
  assert.deepEqual(exercise('agree', 1), exercise('agree', 1, []), 'nothing studied: the page as it was');
});

test('every noun in a drill says what it means and its gender, for the popup over it', () => {
  const studied = nounsOf([noun('la voiture', 'car', 'f'), noun('les clés', 'keys', 'f', 'pl')]);
  for (const kind of ['agree', 'hisher', 'vowel', 'owners', 'table'] as const) {
    for (const item of exercise(kind, 3, studied).items) assert.match(item.gloss ?? '', /^.+ · (masculine|feminine)( plural)?$/, item.id);
  }
  const car = exercise('agree', 3, studied).items.find((i) => i.after === 'voiture');
  if (car) assert.equal(car.gloss, 'car · feminine');
  assert.ok(exercise('context', 3).items.every((i) => i.gloss === undefined), 'a sentence is not one noun');
});
