import { test } from 'vitest';
import assert from 'node:assert/strict';
import { card, ms, word } from './make.js';
import { orderByForgetting, placeReturn, planSitting, returnPosition } from '../src/lib/plan.js';
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

const own = (key: string): ReturnType<typeof card> =>
  card(key, 'written', 'recognise', { lesson: true });
const many = (prefix: string, n: number): ReturnType<typeof card>[] =>
  Array.from({ length: n }, (_, i) => card(`${prefix}${i}|noun`));
const isOwn = (c: { lesson?: string | true }): boolean => !!c.lesson;
const dealtKeys = (list: readonly { key: string }[]): string[] => list.map((c) => c.key);

test('one new card every few cards, starting with the first, your own words first in the order you added them', () => {
  const out = planSitting({
    capacity: 20, exploreEvery: 5, due: many('r', 10),
    ownNew: [own('o1|noun'), own('o2|noun')], catalogueNew: many('c', 3), refresher: [], isOwn,
  });
  assert.equal(out[0]?.key, 'o1|noun', 'the open starts with a new word');
  assert.equal(out[5]?.key, 'o2|noun', 'yours before the catalogue’s');
  assert.equal(out[10]?.key, 'c0|noun');
  assert.equal(out.length, 14, 'ten reviews and four of the places filled');
  assert.ok(!dealtKeys(out).includes('c2|noun'), 'the fifth new word waits for the next open');
});

test('with nothing due, new cards come one after another', () => {
  const out = planSitting({ capacity: 10, exploreEvery: 5, due: [],
    ownNew: [own('o1|noun'), own('o2|noun'), own('o3|noun')], catalogueNew: [], refresher: [], isOwn });
  assert.deepEqual(dealtKeys(out), ['o1|noun', 'o2|noun', 'o3|noun']);
});

test('new words beyond the sitting’s places wait for the next open, in order', () => {
  /* Forty words pasted in are not forty first meetings in a row: Reddy et
     al. (KDD 2016) show mastery collapsing when new items arrive faster than
     the reviews can absorb them. */
  const out = planSitting({ capacity: 10, exploreEvery: 5, due: many('r', 20),
    ownNew: Array.from({ length: 5 }, (_, i) => own(`o${i}|noun`)), catalogueNew: many('c', 2),
    refresher: [], isOwn });
  assert.equal(out.length, 10);
  assert.deepEqual(dealtKeys(out).filter((k) => k.startsWith('o')), ['o0|noun', 'o1|noun']);
  assert.ok(!dealtKeys(out).some((k) => k.startsWith('c')), 'the catalogue waits behind your own');
});

test('catalogue cards are cut before your own when more is due than fits', () => {
  /* Your own words sit last in the order — the best remembered — and are
     still dealt; it is the catalogue's bottom that goes. */
  const due = [...many('r', 10), own('mine1|noun'), own('mine2|noun'), own('mine3|noun')];
  const out = planSitting({ capacity: 8, exploreEvery: 5, due, ownNew: [], catalogueNew: [],
    refresher: [], isOwn });
  assert.equal(out.length, 8);
  assert.deepEqual(dealtKeys(out).filter((k) => k.startsWith('mine')),
    ['mine1|noun', 'mine2|noun', 'mine3|noun']);
  assert.deepEqual(dealtKeys(out).filter((k) => k.startsWith('r')),
    ['r0|noun', 'r1|noun', 'r2|noun', 'r3|noun', 'r4|noun'], 'the first five: the least remembered');
});

test('refreshers fill only the room the due cards leave', () => {
  const some = planSitting({ capacity: 6, exploreEvery: 5, due: many('r', 3), ownNew: [],
    catalogueNew: [], refresher: many('w', 5), isOwn });
  assert.deepEqual(dealtKeys(some), ['r0|noun', 'r1|noun', 'r2|noun', 'w0|noun', 'w1|noun', 'w2|noun']);
  const none = planSitting({ capacity: 6, exploreEvery: 5, due: many('r', 6), ownNew: [],
    catalogueNew: [], refresher: many('w', 5), isOwn });
  assert.ok(!dealtKeys(none).some((k) => k.startsWith('w')), 'a full sitting has no room to keep warm');
});

test('the same inputs deal the same sitting', () => {
  const input = { capacity: 12, exploreEvery: 4, due: many('r', 9), ownNew: [own('o|noun')],
    catalogueNew: many('c', 2), refresher: many('w', 2), isOwn };
  assert.deepEqual(dealtKeys(planSitting(input)), dealtKeys(planSitting(input)));
});
