/** A sitting written down: what is saved, what is resumed, and what is dropped. */
import { Rating } from 'ts-fsrs';
import { expect, test } from 'vitest';

import {
  parseCardId,
  restoreHistory,
  resumable,
  snapshot,
  topUp,
  UNTOUCHED_FOR,
} from '../src/lib/queue';
import { emptyCard } from '../src/lib/scheduler';
import type { CardId, SittingHistoryRow, SittingItem, SittingSnapshot } from '../src/lib/types';

/** One card of a sitting, named by its id alone: nothing here reads the card's
 *  schedule or the word behind it, only which card it is. */
const item = (id: CardId): SittingItem => ({
  card: { ...emptyCard('a|noun', 'written', 'say'), id },
  word: { k: 'a|noun', fr: 'le bug', en: ['bug'] },
});

/** A written-down sitting, with the fields `resumable()` does not read filled
 *  in: an empty tally, no history, and a stamp of 0 — which is exactly what an
 *  unstamped snapshot already counts as. */
const sitting = (
  over: Partial<SittingSnapshot> & Pick<SittingSnapshot, 'ids' | 'i' | 'day'>,
): SittingSnapshot => ({
  done: { answered: 0, right: 0, learned: 0, promoted: 0, heard: 0 },
  history: [],
  at: 0,
  ...over,
});

/** Local midnight of the day every snapshot below was dealt on. */
const DAY = new Date('2026-09-10T09:00:00').setHours(0, 0, 0, 0);

test('a card id is read from the right, since the key holds a bar of its own', () => {
  expect(parseCardId('bus|noun|written|recognise')).toEqual({
    key: 'bus|noun',
    channel: 'written',
    rung: 'recognise',
  });
  expect(parseCardId('le bus|unknown|heard|dictate')).toEqual({
    key: 'le bus|unknown',
    channel: 'heard',
    rung: 'dictate',
  });
  expect(parseCardId('nonsense')).toBe(null);
  expect(parseCardId(undefined)).toBe(null);
});

test('a sitting is carried on where it was left', () => {
  const saved = sitting({ ids: ['a|n|written|say', 'b|n|written|say'], i: 1, day: DAY });
  expect(resumable(saved, { dayStart: DAY })).toBe(true);
  expect(
    resumable({ ...saved, at: 0 }, { dayStart: DAY }),
    'started this morning and left for hours: still yours to finish',
  ).toBe(true);
});

test('a queue nobody started goes stale, since more falls due all day', () => {
  const now = DAY + 12 * 3600 * 1000;
  const dealt = sitting({ ids: ['a|n|written|say'], i: 0, day: DAY, at: now });
  expect(resumable(dealt, { dayStart: DAY, now }), 'just dealt').toBe(true);
  expect(resumable({ ...dealt, at: now - UNTOUCHED_FOR + 1000 }, { dayStart: DAY, now })).toBe(
    true,
  );
  expect(resumable({ ...dealt, at: now - UNTOUCHED_FOR - 1000 }, { dayStart: DAY, now })).toBe(
    false,
  );
});

test('a sitting from another day, from the old walk, or already finished is not', () => {
  const saved = sitting({ ids: ['a|n|written|say'], i: 0, day: DAY });
  expect(resumable(saved, { dayStart: DAY - 86400000 }), 'yesterday').toBe(false);
  expect(
    resumable({ ...saved, walk: true }, { dayStart: DAY }),
    'a walk queue was dealt without the typed rungs',
  ).toBe(false);
  expect(resumable({ ...saved, i: 1 }, { dayStart: DAY }), 'nothing left').toBe(false);
  expect(resumable(null, { dayStart: DAY })).toBe(false);
  expect(resumable(sitting({ ids: [], i: 0, day: DAY }), { dayStart: DAY })).toBe(false);
});

test('what is written down is ids and answers, not words', () => {
  const items = [item('a|n|written|say'), item('b|n|written|write')];
  const state = snapshot({
    items,
    i: 1,
    day: DAY,
    done: { answered: 1, right: 1 },
    history: [
      { item: items[0], rating: Rating.Good, typed: 'le bus', verdict: { verdict: 'ok' } },
    ],
  });
  expect(state.ids).toEqual(['a|n|written|say', 'b|n|written|write']);
  expect(state.i).toBe(1);
  expect(state.history).toEqual([
    { id: 'a|n|written|say', rating: Rating.Good, typed: 'le bus', verdict: { verdict: 'ok' } },
  ]);
  expect(state.done.answered).toBe(1);
});

test('history comes back onto the cards it was about', () => {
  const items = [item('a|n|written|say'), item('b|n|written|write')];
  const rows: SittingHistoryRow[] = [
    { id: 'a|n|written|say', rating: Rating.Hard, typed: '', verdict: null },
  ];
  expect(restoreHistory(rows, items)).toEqual([
    { item: items[0], rating: Rating.Hard, typed: '', verdict: null },
  ]);
});

test('a card answered twice keeps its two answers apart', () => {
  /* An "Again" puts the card back at the end of the queue, so the same id can
     stand at two positions with two different answers. */
  const again = item('a|n|written|say');
  const items = [again, item('b|n|written|write'), again];
  const rows: SittingHistoryRow[] = [
    { id: 'a|n|written|say', rating: Rating.Again, typed: 'wrong' },
    { id: 'b|n|written|write', rating: Rating.Good, typed: '' },
    { id: 'a|n|written|say', rating: Rating.Good, typed: 'right' },
  ];
  expect(restoreHistory(rows, items).map((h) => h.typed)).toEqual(['wrong', '', 'right']);
});

test('history about a card no longer in the queue is dropped, not guessed at', () => {
  const rows: SittingHistoryRow[] = [{ id: 'gone|n|written|say', rating: Rating.Good }];
  expect(restoreHistory(rows, [item('a|n|written|say')])).toEqual([]);
});

test('words added mid-sitting go in next, behind nothing already answered', () => {
  const items = [item('a|n|written|say'), item('b|n|written|write'), item('c|n|written|say')];
  const added = [item('mine|noun|written|recognise'), item('b|n|written|write')];
  const out = topUp(items, 1, added);
  expect(out.map((it) => it.card.id)).toEqual([
    'a|n|written|say',
    'mine|noun|written|recognise',
    'b|n|written|write',
    'c|n|written|say',
  ]);
  expect(topUp(items, 1, []), 'nothing to add: the same queue').toBe(items);
  expect(topUp(items, 1, [item('b|n|written|write')]), 'already queued: unchanged').toBe(items);
  /* The answered cards are exactly where the history expects them. */
  const rows: SittingHistoryRow[] = [{ id: 'a|n|written|say', rating: Rating.Good }];
  expect(restoreHistory(rows, out)[0].item).toBe(items[0]);
});
