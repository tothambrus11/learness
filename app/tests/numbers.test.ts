/** The number grammar: every integer in words, in both dialects, with the
 *  rule behind every word — and the exceptions, each one.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { answerCells } from '../src/lib/grammar/instance.js';
import { digits, MAX_NUMBER, NUMBER_POOLS, numberFor, numberRules, rulesOf, spell, spellings, words }
  from '../src/lib/grammar/numbers.js';
import { isRuleId } from '../src/lib/grammar/rules.js';

test('the Swiss forms, every exception included', () => {
  const table: [number, string][] = [
    [0, 'zéro'], [1, 'un'], [11, 'onze'], [16, 'seize'], [17, 'dix-sept'], [19, 'dix-neuf'],
    [20, 'vingt'], [21, 'vingt et un'], [22, 'vingt-deux'], [31, 'trente et un'], [45, 'quarante-cinq'],
    [70, 'septante'], [71, 'septante et un'], [79, 'septante-neuf'], [80, 'huitante'], [81, 'huitante et un'],
    [90, 'nonante'], [91, 'nonante et un'], [99, 'nonante-neuf'],
    [100, 'cent'], [101, 'cent un'], [180, 'cent huitante'], [200, 'deux cents'], [201, 'deux cent un'],
    [281, 'deux cent huitante et un'], [999, 'neuf cent nonante-neuf'],
    [1000, 'mille'], [1001, 'mille un'], [2000, 'deux mille'], [2026, 'deux mille vingt-six'],
    [10_000, 'dix mille'], [200_000, 'deux cent mille'], [1_000_000, 'un million'],
    [2_000_000, 'deux millions'], [1_500_000, 'un million cinq cent mille'],
    [2_300_000, 'deux millions trois cent mille'], [250_000_000, 'deux cent cinquante millions'],
    [200_000_000, 'deux cents millions'], [80_000, 'huitante mille'],
  ];
  for (const [n, want] of table) assert.equal(words(n), want, String(n));
});

test('the French compounds: sixty plus a teen, four twenties, the s and the et where they belong', () => {
  const table: [number, string][] = [
    [69, 'soixante-neuf'], [70, 'soixante-dix'], [71, 'soixante et onze'], [72, 'soixante-douze'],
    [77, 'soixante-dix-sept'], [79, 'soixante-dix-neuf'], [80, 'quatre-vingts'], [81, 'quatre-vingt-un'],
    [85, 'quatre-vingt-cinq'], [90, 'quatre-vingt-dix'], [91, 'quatre-vingt-onze'], [99, 'quatre-vingt-dix-neuf'],
    [180, 'cent quatre-vingts'], [281, 'deux cent quatre-vingt-un'], [1_980, 'mille neuf cent quatre-vingts'],
    [80_000, 'quatre-vingt mille'], [80_000_000, 'quatre-vingts millions'],
  ];
  for (const [n, want] of table) assert.equal(words(n, 'fr'), want, String(n));
  assert.equal(words(21, 'fr'), 'vingt et un', 'below seventy nothing changes');
});

test('the 1990 spelling is accepted beside the traditional one, where they differ', () => {
  assert.deepEqual(spellings(21), ['vingt et un', 'vingt-et-un']);
  assert.deepEqual(spellings(201), ['deux cent un', 'deux-cent-un']);
  assert.deepEqual(spellings(22), ['vingt-deux'], 'nothing to differ on');
  assert.deepEqual(spellings(71, 'fr'), ['soixante et onze', 'soixante-et-onze']);
});

test('every word names the rule that put it there, and a number is an instance of each rule it uses', () => {
  assert.deepEqual(spell(21).map((t) => [t.text, t.of]), [
    ['vingt', ['N.tens', 'N.et-un']], ['et', ['N.et-un']], ['un', ['N.et-un', 'N.units']],
  ]);
  assert.deepEqual(rulesOf(281), ['N.cent', 'N.units', 'N.tens', 'N.et-un']);
  assert.deepEqual(rulesOf(1001), ['N.mille', 'N.units']);
  assert.deepEqual(rulesOf(2_300_000), ['N.million', 'N.units', 'N.mille', 'N.cent']);
  assert.deepEqual(rulesOf(75, 'fr'), ['N.french-tens', 'N.units']);
  for (const n of [0, 17, 21, 99, 281, 2026, 1_000_000]) {
    for (const t of spell(n)) for (const r of t.of) assert.ok(isRuleId(r), `${n}: ${r}`);
  }
  assert.throws(() => spell(-1));
  assert.throws(() => spell(MAX_NUMBER + 1));
  assert.throws(() => spell(1.5));
});

test('a number written wrong is wrong about the rules whose words are missing, and right about the rest', () => {
  const it = numberFor(281, 'N.et-un');
  assert.equal(it.id, 'number:281');
  assert.equal(it.title, '281');
  assert.deepEqual(it.cells[0]?.also, ['deux-cent-huitante-et-un']);
  const judge = (typed: string) => Object.fromEntries(answerCells(it, [typed])[0]!.obs.map((o) => [o.of, o.ok]));
  assert.deepEqual(judge('deux cent huitante et un'), { 'N.cent': true, 'N.units': true, 'N.tens': true, 'N.et-un': true });
  assert.deepEqual(judge('deux-cent-huitante-et-un'), { 'N.cent': true, 'N.units': true, 'N.tens': true, 'N.et-un': true },
    'the reformed spelling is right');
  assert.deepEqual(judge('deux cent huitante-un'), { 'N.cent': true, 'N.units': true, 'N.tens': true, 'N.et-un': false },
    'the et missing is the et-un rule alone');
  assert.deepEqual(judge('deux cent quatre-vingt-un'), { 'N.cent': true, 'N.units': true, 'N.tens': false, 'N.et-un': false },
    'the French eighty: the Swiss ten is missing, and so is the et');
  assert.deepEqual(judge('deux cents huitante et un'), { 'N.cent': false, 'N.units': true, 'N.tens': true, 'N.et-un': true },
    'cents with something after it is the cent rule');
  assert.deepEqual(judge(''), { 'N.cent': false, 'N.units': false, 'N.tens': false, 'N.et-un': false });
});

test('every pool drills its own rule, and the French compounds only for a learner who writes them', () => {
  for (const [rule, pool] of Object.entries(NUMBER_POOLS)) {
    assert.ok(isRuleId(rule));
    const dialect = rule === 'N.french-tens' ? 'fr' : 'ch';
    for (const n of pool) assert.ok(rulesOf(n, dialect).includes(rule), `${rule}: ${n} is ${words(n, dialect)}`);
  }
  assert.ok(!numberRules('ch').includes('N.french-tens'));
  assert.ok(numberRules('fr').includes('N.french-tens'));
  assert.equal(numberFor(70, 'N.tens', 'fr').id, 'number:70:fr', 'the French seventy is another exercise');
  assert.equal(digits(1_000_000), '1 000 000');
});
