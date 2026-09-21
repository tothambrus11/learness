import { test } from 'vitest';
import assert from 'node:assert/strict';
import { card, ms, review, settings as madeSettings, word } from './make.js';
import {
  budgetFor, DEFAULT_MINUTES, DEFAULT_PACE_MS, dayPlan, interleave, orderByForgetting, owedNow,
  PACE_CEILING_MS, PACE_FLOOR_MS, paceOf, placeReturn, planSitting, returnPosition,
} from '../src/lib/plan.js';
import { dayStart } from '../src/lib/progress.js';
import { MINUTE_MS, secOf } from '../src/lib/units.js';
import { keyOf } from '../src/lib/queue.js';
import type { StudyItem } from '../src/lib/queue.js';

const NOW = ms(new Date('2026-06-01T08:00:00Z').getTime());
const PACE = 25_000;
const at = (offsetMs: number): ReturnType<typeof ms> => ms(NOW + offsetMs);
const item = (key: string, due: number): StudyItem =>
  ({ kind: 'word', card: card(key, 'written', 'recognise', { due: new Date(due) }), word: word() });
const dealt = (list: readonly StudyItem[]): (string | null)[] => list.map((it) => keyOf(it));

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

/* ------------------------------------------------------------ the day -- */

const NOON = new Date('2026-06-15T12:00:00');
/** A row answered this many hours before noon, taking `took` ms. */
const answered = (hoursAgo: number, took: number | null): ReturnType<typeof review> =>
  review({ ts: secOf(ms(NOON.getTime() - hoursAgo * 3600_000)), ms: took });

test('the pace is the middle of your answers, so one long think does not move it', () => {
  const rows = [
    ...Array.from({ length: 24 }, (_, i) => answered(i + 1, 20_000)),
    answered(2, 300_000),
  ];
  assert.equal(paceOf(rows, { now: NOON }), 20_000);
});

test('the pace is the default until the log has enough to say better, and never absurd', () => {
  const few = Array.from({ length: 19 }, (_, i) => answered(i + 1, 20_000));
  assert.equal(paceOf(few, { now: NOON }), DEFAULT_PACE_MS, 'nineteen rows is not evidence');
  const taps = Array.from({ length: 30 }, (_, i) => answered(i + 1, 1_000));
  assert.equal(paceOf(taps, { now: NOON }), PACE_FLOOR_MS, 'taps through a backlog are not a pace');
  const walks = Array.from({ length: 30 }, (_, i) => answered(i + 1, 200_000));
  assert.equal(paceOf(walks, { now: NOON }), PACE_CEILING_MS, 'nor is the phone put down mid-card');
  const untimed = Array.from({ length: 30 }, (_, i) => answered(i + 1, null));
  assert.equal(paceOf(untimed, { now: NOON }), DEFAULT_PACE_MS, 'a row with no time never counts');
  const old = Array.from({ length: 30 }, (_, i) => answered(24 * 20 + i, 20_000));
  assert.equal(paceOf(old, { now: NOON }), DEFAULT_PACE_MS, 'three weeks ago is not the pace now');
});

test('a day’s minutes are read off its weekday, Monday first', () => {
  const week = madeSettings({ minutesByWeekday: [10, 20, 30, 40, 50, 60, 70] });
  assert.equal(budgetFor(week, new Date('2026-06-01T12:00:00')), 10 * MINUTE_MS, 'a Monday');
  assert.equal(budgetFor(week, new Date('2026-06-07T12:00:00')), 70 * MINUTE_MS, 'a Sunday');
  assert.equal(budgetFor(madeSettings({ minutesByWeekday: [0, 0, 0, 0, 0, 0, 0] }), NOON), 0,
    'zero is a day off, not a missing value');
  assert.equal(budgetFor(madeSettings({ minutesByWeekday: [] }), NOON), DEFAULT_MINUTES * MINUTE_MS,
    'a week stored short falls back to the default');
  assert.equal(budgetFor({ minutesByWeekday: 'twenty' as unknown as number[] }, NOON),
    DEFAULT_MINUTES * MINUTE_MS, 'as does a row of the wrong shape');
});

test('the day’s plan is minutes over pace, and what is left is minutes not yet spent', () => {
  const s = madeSettings({ minutesByWeekday: [20, 20, 20, 20, 20, 20, 20] });
  /* Answers a minute long, ten minutes apart from eight in the morning. */
  const today = (n: number, took = MINUTE_MS): ReturnType<typeof review>[] =>
    Array.from({ length: n }, (_, i) =>
      review({ ts: secOf(ms(dayStart(NOON, s.dayStartsAt) + (8 * 60 + i * 10) * MINUTE_MS)), ms: took }));
  const some = dayPlan({ settings: s, reviews: today(15), now: NOON });
  assert.equal(some.paceMs, DEFAULT_PACE_MS, 'fifteen rows: the default pace');
  assert.equal(some.size, 48, 'twenty minutes at twenty-five seconds a card');
  assert.equal(some.spentMs, 15 * MINUTE_MS);
  assert.equal(some.remainingMs, 5 * MINUTE_MS);
  assert.equal(some.spent, false);
  const all = dayPlan({ settings: s, reviews: today(20), now: NOON });
  assert.equal(all.remainingMs, 0, 'never negative');
  assert.equal(all.spent, true);
  const yesterday = review({ ts: secOf(ms(dayStart(NOON, s.dayStartsAt) - 3600_000)), ms: 60 * MINUTE_MS });
  assert.equal(dayPlan({ settings: s, reviews: [yesterday], now: NOON }).spentMs, 0,
    'yesterday’s hour is not today’s');
  /* A card revealed before a forty-minute phone call is not forty minutes of
     answering, and it must not be the whole day's budget either: it counts
     for what the pace would, and no more. */
  const call = dayPlan({ settings: s, reviews: today(1, 40 * MINUTE_MS), now: NOON });
  assert.equal(call.spentMs, PACE_CEILING_MS);
  assert.equal(call.spent, false);
});

test('what the day owes is one rule for every screen', () => {
  /* The home screen counted every due card, the sitting counted its own way,
     and the two disagreed about the day's new words. */
  const cards = [
    card('due|noun', 'written', 'recognise', { state: 2, due: new Date(NOW - 3600_000) }),
    card('later|noun', 'written', 'recognise', { state: 2, due: new Date(NOW + 3600_000) }),
    card('step|noun', 'written', 'recognise', { state: 1, due: new Date(NOW + 5 * MINUTE_MS) }),
    card('far|noun', 'written', 'recognise', { state: 1, due: new Date(NOW + 45 * MINUTE_MS) }),
    card('mine|noun', 'written', 'recognise', { lesson: true, due: new Date(NOW - 1000) }),
  ];
  assert.deepEqual(owedNow(cards, new Date(NOW)).map((c) => c.key), ['due|noun', 'step|noun'],
    'due now, and a learning step within the sitting; not a review for later, a step beyond '
    + 'the horizon, or a word of your own never met — that is exploration, not debt');
});

test('grammar exercises fall among the cards half a beat off the new words, and the rest go at the end', () => {
  const cards = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(interleave(cards, ['X', 'Y'], 4), ['a', 'b', 'X', 'c', 'd', 'e', 'f', 'Y', 'g'],
    'two in, then every four cards');
  assert.deepEqual(interleave(['a'], ['X', 'Y'], 4), ['a', 'X', 'Y'], 'past the end, in order');
  assert.deepEqual(interleave([], ['X'], 4), ['X']);
  assert.deepEqual(interleave(cards, [], 4), cards);
  assert.deepEqual(interleave(cards, ['X'], 1), ['a', 'X', 'b', 'c', 'd', 'e', 'f', 'g'], 'never closer than two');
});
