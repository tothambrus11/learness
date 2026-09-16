import { test } from 'vitest';
import assert from 'node:assert/strict';
import { card } from './make.js';
import { orderByForgetting } from '../src/lib/plan.js';

test('due cards are dealt likeliest-forgotten first, and ties fall the same way every time', () => {
  const recall: Record<string, number> = {
    'a|noun': 0.6, 'b|noun': 0.3, 'c|noun': 0.3, 'd|noun': 0.9,
  };
  const cards = [
    card('a|noun', 'written', 'recognise', { due: new Date('2026-06-01T08:00:00Z') }),
    card('b|noun', 'written', 'recognise', { due: new Date('2026-06-01T09:00:00Z') }),
    /* The same chance of forgetting as b, and fell due an hour earlier. */
    card('c|noun', 'written', 'recognise', { due: new Date('2026-06-01T08:00:00Z') }),
    card('d|noun', 'written', 'recognise', { due: new Date('2026-06-01T07:00:00Z') }),
  ];
  const rOf = (c: { key: string }): number => recall[c.key] ?? 1;
  const keys = (list: readonly { key: string }[]): string[] => list.map((c) => c.key);

  assert.deepEqual(keys(orderByForgetting(cards, rOf)), ['c|noun', 'b|noun', 'a|noun', 'd|noun'],
    'least remembered first; among equals, the one that has waited longest');
  assert.deepEqual(keys(orderByForgetting(cards.toReversed(), rOf)),
    ['c|noun', 'b|noun', 'a|noun', 'd|noun'],
    'the order the cards arrive in makes no difference, so two phones deal alike');
  assert.deepEqual(keys(cards), ['a|noun', 'b|noun', 'c|noun', 'd|noun'], 'the input is left alone');
});

test('two cards alike in every way are told apart by id, not by luck', () => {
  const same = { due: new Date('2026-06-01T08:00:00Z') };
  const cards = [
    card('zèbre|noun', 'written', 'recognise', same),
    card('âne|noun', 'written', 'recognise', same),
    card('chat|noun', 'written', 'recognise', same),
  ];
  const twice = [orderByForgetting(cards, () => 0.5), orderByForgetting(cards, () => 0.5)];
  assert.deepEqual(twice[0]!.map((c) => c.id), twice[1]!.map((c) => c.id));
  /* Code units, not the locale: "âne" sorts after "zèbre" on every device
     alike, where a locale-aware sort would put it first on some. */
  assert.deepEqual(twice[0]!.map((c) => c.key), ['chat|noun', 'zèbre|noun', 'âne|noun']);
});
