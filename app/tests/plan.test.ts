import { test } from 'vitest';
import assert from 'node:assert/strict';
import { card, ms, word } from './make.js';
import { orderByForgetting, placeReturn, returnPosition } from '../src/lib/plan.js';
import type { StudyItem } from '../src/lib/queue.js';

const NOW = ms(new Date('2026-06-01T08:00:00Z').getTime());
const PACE = 25_000;
const at = (offsetMs: number): ReturnType<typeof ms> => ms(NOW + offsetMs);
const item = (key: string, due: number): StudyItem =>
  ({ card: card(key, 'written', 'recognise', { due: new Date(due) }), word: word() });
const dealt = (list: readonly StudyItem[]): string[] => list.map((it) => it.card.key);

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

test('a card that comes back in a minute is two cards away; in ten, twenty-odd', () => {
  assert.equal(returnPosition(at(60_000), NOW, PACE), 2);
  assert.equal(returnPosition(at(600_000), NOW, PACE), 24);
  assert.equal(returnPosition(at(-5_000), NOW, PACE), 1, 'already due: the next card');
  assert.equal(returnPosition(at(10_000), NOW, PACE), 1, 'never nearer than the next card');
});

test('a return beyond the end is dealt at once if it is a minute away, and waits otherwise', () => {
  const queue = [item('a|noun', NOW), item('b|noun', NOW)];
  const soon = placeReturn(queue, 2, item('c|noun', NOW + 60_000), { now: NOW, paceMs: PACE });
  assert.equal(soon.held, false);
  assert.deepEqual(dealt(soon.queue), ['a|noun', 'b|noun', 'c|noun']);

  const later = placeReturn(queue, 2, item('c|noun', NOW + 600_000), { now: NOW, paceMs: PACE });
  assert.equal(later.held, true);
  assert.deepEqual(dealt(later.queue), ['a|noun', 'b|noun']);

  const within = placeReturn(queue, 0, item('c|noun', NOW + 60_000), { now: NOW, paceMs: PACE });
  assert.deepEqual(dealt(within.queue), ['a|noun', 'c|noun', 'b|noun'], 'two away: after one other');
  assert.deepEqual(dealt(queue), ['a|noun', 'b|noun'], 'the queue given is not touched');
});

test('a card already ahead is not placed twice', () => {
  const c = item('c|noun', NOW + 60_000);
  const ahead = [item('a|noun', NOW), c, item('b|noun', NOW)];
  const twice = placeReturn(ahead, 1, c, { now: NOW, paceMs: PACE });
  assert.equal(twice.held, false);
  assert.deepEqual(dealt(twice.queue), ['a|noun', 'c|noun', 'b|noun']);
  /* Behind the next card is an answered copy, which is not "ahead". */
  const behind = [c, item('a|noun', NOW), item('b|noun', NOW)];
  assert.deepEqual(dealt(placeReturn(behind, 1, c, { now: NOW, paceMs: PACE }).queue),
    ['c|noun', 'a|noun', 'c|noun', 'b|noun']);
});
