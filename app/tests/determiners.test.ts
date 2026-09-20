/** The determiner drills: what a noun's article says about it, and the
 *  little word before it that each rule decides.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { contracted, demonstrative, determinerFor, determinersFor, possessive, shapeOf }
  from '../src/lib/grammar/determiners.js';
import { word } from './make.js';

const noun = (fr: string, over: Partial<Parameters<typeof word>[0]> = {}) =>
  word({ k: `${fr.replace(/^(le|la|les|l['’])\s*/, '')}|noun`, fr, en: ['a thing'], ...over });

test('a noun’s article says its gender, its number and whether it begins with a vowel', () => {
  assert.deepEqual(shapeOf(noun('le jour', { gender: 'm' })), { noun: 'jour', gender: 'm', plural: false, vowel: false });
  assert.deepEqual(shapeOf(noun('la ville', { gender: 'f' })), { noun: 'ville', gender: 'f', plural: false, vowel: false });
  assert.deepEqual(shapeOf(noun("l'enfant", { gender: 'm' })), { noun: 'enfant', gender: 'm', plural: false, vowel: true });
  assert.deepEqual(shapeOf(noun('l’amie', { gender: 'f' })), { noun: 'amie', gender: 'f', plural: false, vowel: true });
  assert.deepEqual(shapeOf(noun('les gens', { gender: 'm', number: 'pl' })), { noun: 'gens', gender: 'm', plural: true, vowel: false });
  assert.equal(shapeOf(noun('Genève')), null, 'no article, no drill');
  assert.equal(shapeOf(noun('lettre', { gender: 'f' })), null, 'le is not the start of lettre');
  assert.equal(shapeOf(noun("l'hôtel")), null, 'l’ alone does not say the gender');
  assert.equal(shapeOf(noun('le jour'))?.gender, 'm', 'the article does, where the record does not');
});

test('à and de fuse with le and les, and with nothing else', () => {
  const table: [string, 'm' | 'f', 'pl' | undefined, string, string][] = [
    ['le marché', 'm', undefined, 'au marché', 'du marché'],
    ['la gare', 'f', undefined, 'à la gare', 'de la gare'],
    ["l'école", 'f', undefined, "à l'école", "de l'école"],
    ['les enfants', 'm', 'pl', 'aux enfants', 'des enfants'],
  ];
  for (const [fr, gender, number, a, de] of table) {
    const s = shapeOf(noun(fr, { gender, ...(number ? { number } : {}) }))!;
    assert.equal(contracted('à', s), a, fr);
    assert.equal(contracted('de', s), de, fr);
  }
});

test('mon before a feminine vowel, ma otherwise, mes in the plural; ce, cet, cette, ces', () => {
  const amie = shapeOf(noun('l’amie', { gender: 'f' }))!;
  const mere = shapeOf(noun('la mère', { gender: 'f' }))!;
  const pere = shapeOf(noun('le père', { gender: 'm' }))!;
  const homme = shapeOf(noun("l'homme", { gender: 'm' }))!;
  const gens = shapeOf(noun('les gens', { gender: 'm', number: 'pl' }))!;
  assert.equal(possessive('mon', amie), 'mon amie');
  assert.equal(possessive('son', mere), 'sa mère');
  assert.equal(possessive('ton', pere), 'ton père');
  assert.equal(possessive('mon', gens), 'mes gens');
  assert.equal(possessive('son', gens), 'ses gens');
  assert.equal(demonstrative(pere), 'ce père');
  assert.equal(demonstrative(homme), 'cet homme');
  assert.equal(demonstrative(mere), 'cette mère');
  assert.equal(demonstrative(amie), 'cette amie');
  assert.equal(demonstrative(gens), 'ces gens');
});

test('an exercise is one noun and the forms its rule decides, each cell the rule’s on the whole', () => {
  const enfant = noun("l'enfant", { gender: 'm', en: ['child'] });
  const all = determinersFor(enfant);
  assert.deepEqual(all.map((i) => i.id), ['det:enfant|noun:D.contract', 'det:enfant|noun:D.possessive', 'det:enfant|noun:D.demonstrative']);
  const [contract, poss, dem] = all;
  assert.equal(contract?.title, "l'enfant");
  assert.equal(contract?.hint, 'child');
  assert.deepEqual(contract?.cells.map((c) => [c.prompt, c.expected]), [["à + l'enfant", "à l'enfant"], ["de + l'enfant", "de l'enfant"]]);
  assert.deepEqual(poss?.cells.map((c) => [c.prompt, c.expected]), [['my', 'mon enfant'], ['your (tu)', 'ton enfant'], ['his / her', 'son enfant']]);
  assert.deepEqual(dem?.cells.map((c) => [c.prompt, c.expected]), [['this / that', 'cet enfant']]);
  assert.deepEqual(dem?.cells[0]?.obs, [{ of: 'D.demonstrative', on: 'form' }]);
  assert.equal(determinerFor(noun('Genève'), 'D.contract'), null);
  assert.equal(determinerFor(enfant, 'G.pas'), null, 'not a determiner rule');
});
