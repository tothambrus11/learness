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

test('ordinals: premier, then -ième on the cardinal with its three changes, and unième in a compound', async () => {
  const { ordinal, ordinalFigure, ordinalFor } = await import('../src/lib/grammar/numbers.js');
  const table: [number, string][] = [
    [1, 'premier'], [2, 'deuxième'], [3, 'troisième'], [4, 'quatrième'], [5, 'cinquième'], [9, 'neuvième'],
    [10, 'dixième'], [11, 'onzième'], [12, 'douzième'], [16, 'seizième'], [20, 'vingtième'], [21, 'vingt et unième'],
    [25, 'vingt-cinquième'], [31, 'trente et unième'], [80, 'huitantième'], [100, 'centième'], [200, 'deux centième'],
    [1000, 'millième'],
  ];
  for (const [n, want] of table) assert.equal(ordinal(n), want, String(n));
  assert.equal(ordinal(1, 'ch', true), 'première');
  assert.equal(ordinal(80, 'fr'), 'quatre-vingtième');
  assert.equal(ordinal(71, 'fr'), 'soixante et onzième');
  assert.equal(ordinalFigure(1), '1er');
  assert.equal(ordinalFigure(1, true), '1re');
  assert.equal(ordinalFigure(2), '2e');
  assert.throws(() => ordinal(0));
  assert.equal(ordinalFor(21).id, 'ordinal:21');
  assert.equal(ordinalFor(21).title, '21e');
  assert.equal(ordinalFor(21).cells[0]?.expected, 'vingt et unième');
});

test('the time, said and on a timetable: heure(s), et quart, et demie, moins, midi and minuit', async () => {
  const { timeWords, timeFigure, timeFor } = await import('../src/lib/grammar/numbers.js');
  const table: [number, number, string, string][] = [
    [1, 0, 'il est une heure', 'une heure'],
    [3, 15, 'il est trois heures et quart', 'trois heures quinze'],
    [6, 30, 'il est six heures et demie', 'six heures trente'],
    [8, 45, 'il est neuf heures moins le quart', 'huit heures quarante-cinq'],
    [10, 10, 'il est dix heures dix', 'dix heures dix'],
    [11, 50, 'il est midi moins dix', 'onze heures cinquante'],
    [12, 0, 'il est midi', 'douze heures'],
    [12, 30, 'il est midi et demi', 'douze heures trente'],
    [0, 0, 'il est minuit', 'zéro heure'],
    [0, 15, 'il est minuit et quart', 'zéro heure quinze'],
    [15, 30, 'il est trois heures et demie', 'quinze heures trente'],
    [20, 5, 'il est huit heures cinq', 'vingt heures cinq'],
    [23, 55, 'il est minuit moins cinq', 'vingt-trois heures cinquante-cinq'],
    [21, 0, 'il est neuf heures', 'vingt et une heures'],
  ];
  for (const [h, m, said, clock] of table) {
    assert.equal(timeWords(h, m), said, `${h}:${m} said`);
    assert.equal(timeWords(h, m, 'clock'), clock, `${h}:${m} clock`);
  }
  assert.throws(() => timeWords(24, 0));
  assert.equal(timeFigure(8, 5), '8:05');
  const t = timeFor(15, 30);
  assert.equal(t.id, 'time:15:30');
  assert.deepEqual(t.cells.map((c) => [c.prompt, c.expected]),
    [['said', 'il est trois heures et demie'], ['timetable', 'quinze heures trente']]);
});

test('dates: le premier, then cardinals; a weekday takes the le away and no capital; a year in thousands', async () => {
  const { dateWords, yearWords, dateFigure, dateFor, datesFor } = await import('../src/lib/grammar/numbers.js');
  assert.equal(dateWords(1, 5), 'le premier mai');
  assert.equal(dateWords(2, 5), 'le deux mai');
  assert.equal(dateWords(14, 7), 'le quatorze juillet');
  assert.equal(dateWords(3, 9, 4), 'jeudi trois septembre');
  assert.equal(dateWords(1, 8, 6), 'samedi premier août');
  assert.equal(yearWords(2015), 'en deux mille quinze');
  assert.equal(yearWords(1918), 'en mille neuf cent dix-huit');
  assert.equal(yearWords(1980, 'fr'), 'en mille neuf cent quatre-vingts');
  assert.throws(() => dateWords(32, 1));
  assert.throws(() => dateWords(1, 13));
  assert.equal(dateFigure(3, 9, 4), 'jeudi 3.9');
  const d = dateFor({ day: 1, month: 1, year: 2026 });
  assert.equal(d.id, 'date:1.1:2026');
  assert.equal(d.title, '1.1 · 2026');
  assert.deepEqual(d.cells.map((c) => [c.prompt, c.expected]), [['', 'le premier janvier'], ['the year', 'en deux mille vingt-six']]);
  assert.equal(new Set(datesFor().map((i) => i.id)).size, datesFor().length, 'every date its own instance');
});

test('an age is had, not been, and a price says its unit with the cents bare after it', async () => {
  const { ageWords, ageFor, priceWords, priceFigure, priceFor } = await import('../src/lib/grammar/numbers.js');
  assert.equal(ageWords('je', 30), "j'ai trente ans");
  assert.equal(ageWords('il', 1), 'il a un an');
  assert.equal(ageWords('elle', 21), 'elle a vingt et un ans');
  assert.equal(ageWords('tu', 18), 'tu as dix-huit ans');
  assert.throws(() => ageWords('je', -1));
  assert.equal(ageFor({ who: 'je', years: 30 }).title, 'I am 30');
  assert.equal(ageFor({ who: 'je', years: 30 }).id, 'age:je:30');
  assert.equal(priceWords(3, 50, 'franc'), 'trois francs cinquante');
  assert.equal(priceWords(1, 20, 'euro'), 'un euro vingt');
  assert.equal(priceWords(2, 0, 'franc'), 'deux francs');
  assert.equal(priceWords(0, 90, 'franc'), 'nonante centimes');
  assert.equal(priceWords(1, 5, 'franc'), 'un franc cinq');
  assert.equal(priceWords(0, 1, 'euro'), 'un centime');
  assert.throws(() => priceWords(1, 100, 'euro'));
  assert.equal(priceFigure(3, 50, 'franc'), '3.50 CHF');
  assert.equal(priceFigure(1, 5, 'euro'), '1.05 €');
  assert.equal(priceFor({ units: 3, cents: 50, unit: 'franc' }).id, 'price:3.50:franc');
});

test('a number is also said and heard: the digits to say, the words to hear and type back in figures', async () => {
  const { numberSayFor, numberHearFor, timeSayFor, timeFor, dateFor, ordinalFor, ageFor, priceFor }
    = await import('../src/lib/grammar/numbers.js');
  const say = numberSayFor(41, 'N.et-un');
  assert.equal(say.id, 'say:number:41');
  assert.equal(say.face, 'say');
  assert.equal(say.title, '41');
  assert.deepEqual(say.cells[0] && [say.cells[0].expected, say.cells[0].say], ['quarante et un', true]);
  assert.deepEqual(say.speech, { key: 'grammar|speech', slot: 'say:number:41', text: 'quarante et un', kind: 'form' });
  const hear = numberHearFor(1000, 'N.mille');
  assert.equal(hear.face, 'hear');
  assert.equal(hear.title, '', 'nothing to read: the question is heard');
  assert.equal(hear.speech?.text, 'mille');
  assert.equal(answerCells(hear, ['1000'])[0]?.ok, true);
  assert.equal(answerCells(hear, ['1 000'])[0]?.ok, true, 'with the space French writes');
  assert.equal(answerCells(hear, ['100'])[0]?.ok, false);
  assert.equal(timeSayFor(15, 30).speech?.text, 'il est trois heures et demie');
  /* A number written in silence was the one exercise never heard (#95):
     every written number, ordinal, time, date, age and price says its
     answers once checked, in the order of its cells. */
  assert.deepEqual(numberFor(41, 'N.et-un').speech, { key: 'grammar|speech', slot: 'number:41', text: 'quarante et un', kind: 'form' });
  assert.equal(timeFor(15, 30).speech?.text, 'il est trois heures et demie, quinze heures trente');
  assert.equal(dateFor({ day: 1, month: 1, year: 2026 }).speech?.text, 'le premier janvier, en deux mille vingt-six');
  assert.equal(ordinalFor(2).speech?.text, 'deuxième');
  assert.equal(ageFor({ who: 'je', years: 30 }).speech?.text, "j'ai trente ans");
  assert.equal(priceFor({ units: 3, cents: 50, unit: 'franc' }).speech?.text, 'trois francs cinquante');
});
