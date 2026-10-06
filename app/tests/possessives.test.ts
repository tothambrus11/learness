import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  SHEET_KEY, sheetPhrases,
  BEFORE_ADJECTIVE, NOTES, NOUNS, OWNERS, TABLE, columnOf, hasGender, owned, possessive, rowsOfSheet, thingOf,
  vowelSound,
} from '../src/lib/possessives.js';
import type { Owner } from '../src/lib/possessives.js';
import { possessive as drillPossessive } from '../src/lib/grammar/determiners.js';

const noun = (fr: string) => {
  const n = [...NOUNS, ...BEFORE_ADJECTIVE].find((x) => x.fr === fr);
  assert.ok(n, `no noun ${fr} on the sheet`);
  return n;
};

test('the possessive agrees with the noun it precedes, never with the possessor’s gender', () => {
  /* *son père* is her father as much as his; the English speaker's
     instinct is to write *sa père* for "her father". The row for il/elle
     has no way to know whose it is, and that is the rule. */
  assert.equal(owned(2, noun('père')), 'son père');
  assert.equal(owned(2, noun('mère')), 'sa mère');
  assert.equal(owned(2, noun('parents')), 'ses parents');
  assert.equal(owned(0, noun('voiture')), 'ma voiture');
  assert.equal(owned(5, noun('enfants')), 'leurs enfants');
  assert.equal(owned(4, noun('maison')), 'votre maison');
});

test('before a vowel sound a feminine noun takes mon, ton, son, and stays feminine', () => {
  assert.equal(owned(0, noun('amie')), 'mon amie');
  assert.equal(owned(1, noun('école')), 'ton école');
  assert.equal(owned(2, noun('histoire')), 'son histoire', 'a mute h is a vowel');
  assert.equal(owned(0, noun('harpe')), 'ma harpe', 'an aspirated h is not');
  assert.equal(thingOf(noun('amie')).gender, 'f');
});

test('it is the word straight after the determiner that decides, adjective or noun', () => {
  assert.equal(owned(0, noun('nouvelle amie')), 'ma nouvelle amie');
  assert.equal(owned(0, noun('ancienne école')), 'mon ancienne école');
});

test('the plural owners have one form for both genders, and leurs is plural only in the things', () => {
  for (const o of [3, 4, 5] as Owner[]) {
    assert.equal(hasGender(o), false);
    assert.equal(TABLE[o]![0], TABLE[o]![1], `${OWNERS[o]} has no gender to choose`);
  }
  assert.equal(owned(5, noun('voiture')), 'leur voiture', 'several owners, one car');
  assert.equal(owned(3, noun('amie')), 'notre amie');
});

test('the singular owners’ three forms are three different words', () => {
  for (const o of [0, 1, 2] as Owner[]) assert.equal(new Set(TABLE[o]).size, 3, OWNERS[o]);
});

test('the column is the gender, the number, or the vowel, in that order', () => {
  assert.equal(columnOf({ gender: 'f', plural: true, vowel: true }), 2, 'mes amies: the plural wins');
  assert.equal(columnOf({ gender: 'f', plural: false, vowel: true }), 0);
  assert.equal(columnOf({ gender: 'f', plural: false, vowel: false }), 1);
  assert.equal(columnOf({ gender: 'm', plural: false, vowel: false }), 0);
});

test('a vowel sound is read from the spelling, except an aspirated h, which only the noun can say', () => {
  assert.ok(vowelSound('école'));
  assert.ok(vowelSound('œuvre'));
  assert.ok(vowelSound('habitude'));
  assert.ok(!vowelSound('harpe', true));
  assert.ok(!vowelSound('maison'));
});

test('the sheet draws each plural owner’s singular as one cell, and every cell is its row’s form', () => {
  const rows = rowsOfSheet();
  assert.equal(rows.length, 6);
  for (const row of rows) {
    const spans = row.cells.reduce((n, c) => n + c.span, 0);
    assert.equal(spans, 3, `${row.fr} fills the three columns`);
    assert.equal(row.cells.length, hasGender(row.owner) ? 3 : 2);
    for (const c of row.cells) {
      assert.equal(c.form, TABLE[row.owner]![c.column]);
      assert.ok(c.heard.text.startsWith(`${c.form} `), `${c.heard.text} is heard with its form`);
    }
  }
});

test('the grammar drill and the sheet give the same possessive for the same noun', () => {
  /* Two copies of the rule would come apart; the drill reads the sheet's. */
  for (const n of NOUNS) {
    const s = { noun: n.fr, ...thingOf(n) };
    assert.equal(drillPossessive('mon', s), owned(0, n));
    assert.equal(drillPossessive('son', s), owned(2, n));
    assert.equal(possessive(1, thingOf(n)), TABLE[1]![columnOf(thingOf(n))]);
  }
});

test('the nouns are each on the sheet once, and every note can be heard', () => {
  assert.equal(new Set(NOUNS.map((n) => n.fr)).size, NOUNS.length);
  for (const note of NOTES) assert.ok(note.examples.length > 0, note.head);
});

test('opening the sheet prepares every cell and every example, under the slot its button asks for', () => {
  /* The table was made only as it was tapped, a second and a half each,
     though the page is opened to be heard (#109). */
  const phrases = sheetPhrases();
  const slots = phrases.map((p) => p.slot);
  assert.equal(new Set(slots).size, slots.length, 'each once');
  assert.ok(phrases.every((p) => p.key === SHEET_KEY && p.text === p.slot));
  for (const row of rowsOfSheet()) for (const cell of row.cells) assert.ok(slots.includes(cell.heard.slot), cell.heard.text);
  for (const note of NOTES) for (const text of note.examples) assert.ok(slots.includes(text), text);
  assert.equal(slots[0], 'mon livre', 'the table first, in reading order');
});
