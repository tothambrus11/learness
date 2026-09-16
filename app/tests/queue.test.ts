import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dayRecord, parseCardId, restoreHistory, sameDay } from '../src/lib/queue.js';
import type { DayRecord, SavedHistoryRow, StudyItem } from '../src/lib/queue.js';
import { Rating } from '../src/lib/scheduler.js';
import { card, id as cardIdOf, ms, word } from './make.js';

/* An answer is about a card by id; what hangs off the id does not matter here. */
const item = (id: string): StudyItem =>
  ({ card: { ...card('bug|noun'), id: cardIdOf(id) }, word: word() });
const DAY = ms(new Date('2026-09-10T09:00:00').setHours(0, 0, 0, 0));
const TALLY = { answered: 1, right: 1, learned: 0, promoted: 0, heard: 0 };

test('a card id is read from the right, since the key holds a bar of its own', () => {
  assert.deepEqual(parseCardId('bus|noun|written|recognise'),
    { key: 'bus|noun', channel: 'written', rung: 'recognise' });
  assert.deepEqual(parseCardId('le bus|unknown|heard|dictate'),
    { key: 'le bus|unknown', channel: 'heard', rung: 'dictate' });
  assert.equal(parseCardId('nonsense'), null);
  assert.equal(parseCardId(undefined), null);
});

test('a day’s record is today’s, or it is nothing', () => {
  const record: DayRecord = { day: DAY, done: TALLY, history: [], at: ms(DAY + 1000) };
  assert.equal(sameDay(record, DAY), true);
  assert.equal(sameDay(record, ms(DAY - 86400000)), false, 'yesterday’s is not today’s');
  assert.equal(sameDay(null, DAY), false);
  assert.equal(sameDay({ day: DAY, done: TALLY }, DAY), false, 'no answers list: not a record');
  /* The queue that used to be written down — ids and a position, no tally —
     is a row of the old shape, and is not carried on with. */
  const old: unknown = { ids: [cardIdOf('a|n|written|say')], i: 0, day: DAY };
  assert.equal(sameDay(old as Partial<DayRecord>, DAY), false);
});

test('what is written down is the day’s answers by id and its tally, not the queue', () => {
  const items = [item('a|n|written|say'), item('b|n|written|write')];
  const record = dayRecord({
    day: DAY, done: TALLY,
    history: [{ item: items[0]!, rating: Rating.Good, typed: 'le bus',
      verdict: { verdict: 'ok' } }],
  });
  assert.equal(record.day, DAY);
  assert.deepEqual(record.done, TALLY);
  assert.deepEqual(record.history, [{ id: 'a|n|written|say', rating: Rating.Good, typed: 'le bus',
    verdict: { verdict: 'ok' } }]);
  assert.ok(!('ids' in record) && !('i' in record),
    'no queue and no position: both are asked for again on the next open');
});

test('history comes back onto the cards it was about', () => {
  const a = item('a|n|written|say');
  const rows: Partial<SavedHistoryRow>[] = [
    { id: a.card.id, rating: Rating.Hard, typed: '', verdict: null },
  ];
  assert.deepEqual(restoreHistory(rows, new Map([[a.card.id, a]])),
    [{ item: a, rating: Rating.Hard, typed: '', verdict: null }]);
});

test('a card answered twice in a day has two rows, both about the one card', () => {
  /* An "Again" brings the card back, so the same id is answered twice with
     two different answers — and the two rows are matched by id, since there
     is no queue whose positions could tell them apart. */
  const a = item('a|n|written|say');
  const b = item('b|n|written|write');
  const resolved = new Map([[a.card.id, a], [b.card.id, b]]);
  const rows: Partial<SavedHistoryRow>[] = [
    { id: a.card.id, rating: Rating.Again, typed: 'wrong' },
    { id: b.card.id, rating: Rating.Good, typed: '' },
    { id: a.card.id, rating: Rating.Good, typed: 'right' },
  ];
  const back = restoreHistory(rows, resolved);
  assert.deepEqual(back.map((h) => h.typed), ['wrong', '', 'right']);
  assert.equal(back[0]?.item, back[2]?.item, 'the one card, looked up once');
});

test('an answer about a card that no longer resolves is dropped, not guessed at', () => {
  const a = item('a|n|written|say');
  assert.deepEqual(
    restoreHistory([{ id: cardIdOf('gone|n|written|say'), rating: Rating.Good }],
      new Map([[a.card.id, a]])),
    []);
  assert.deepEqual(restoreHistory([{ id: a.card.id }], new Map([[a.card.id, a]])), [],
    'a row with no answer in it is not history');
});
