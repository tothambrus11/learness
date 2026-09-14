import { test } from 'vitest';
import assert from 'node:assert/strict';
import { UNTOUCHED_FOR, parseCardId, restoreHistory, resumable, snapshot }
  from '../src/lib/queue.js';

import type { SavedHistoryRow, StudyItem } from '../src/lib/queue.js';
import { Rating } from '../src/lib/scheduler.js';
import { card, id as cardIdOf, ms, word } from './make.js';

/* A queue is a list of ids; what hangs off each one does not matter here. */
const item = (id: string): StudyItem =>
  ({ card: { ...card('bug|noun'), id: cardIdOf(id) }, word: word() });
const DAY = ms(new Date('2026-09-10T09:00:00').setHours(0, 0, 0, 0));

test('a card id is read from the right, since the key holds a bar of its own', () => {
  assert.deepEqual(parseCardId('bus|noun|written|recognise'),
    { key: 'bus|noun', channel: 'written', rung: 'recognise' });
  assert.deepEqual(parseCardId('le bus|unknown|heard|dictate'),
    { key: 'le bus|unknown', channel: 'heard', rung: 'dictate' });
  assert.equal(parseCardId('nonsense'), null);
  assert.equal(parseCardId(undefined), null);
});

test('a sitting is carried on where it was left', () => {
  const saved = { ids: [cardIdOf('a|n|written|say'), cardIdOf('b|n|written|say')],
    i: 1, day: DAY };
  assert.equal(resumable(saved, { dayStart: DAY }), true);
  assert.equal(resumable({ ...saved, at: ms(0) }, { dayStart: DAY }), true,
    'started this morning and left for hours: still yours to finish');
});

test('a queue nobody started goes stale, since more falls due all day', () => {
  const now = ms(DAY + 12 * 3600 * 1000);
  const dealt = { ids: [cardIdOf('a|n|written|say')], i: 0, day: DAY, at: now };
  assert.equal(resumable(dealt, { dayStart: DAY, now }), true, 'just dealt');
  assert.equal(
    resumable({ ...dealt, at: ms(now - UNTOUCHED_FOR + 1000) }, { dayStart: DAY, now }), true);
  assert.equal(
    resumable({ ...dealt, at: ms(now - UNTOUCHED_FOR - 1000) }, { dayStart: DAY, now }), false);
});

test('a sitting from another day or already finished is not', () => {
  const saved = { ids: [cardIdOf('a|n|written|say')], i: 0, day: DAY };
  assert.equal(resumable(saved, { dayStart: ms(DAY - 86400000) }), false, 'yesterday');
  assert.equal(resumable({ ...saved, i: 1 }, { dayStart: DAY }), false, 'nothing left');
  assert.equal(resumable(null, { dayStart: DAY }), false);
  assert.equal(resumable({ ids: [], i: 0, day: DAY }, { dayStart: DAY }), false);
});

test('a sitting written down when there were two kinds is still one to carry on', () => {
  /* Rows stored before the walk was removed carry `walk: true`. Nothing reads
     it now, and a queue in hand is not thrown away over a field. */
  const saved = { ids: [cardIdOf('a|n|written|say'), cardIdOf('b|n|written|say')],
    i: 1, walk: true, day: DAY };
  assert.equal(resumable(saved, { dayStart: DAY }), true);
});

test('what is written down is ids and answers, not words', () => {
  const items = [item('a|n|written|say'), item('b|n|written|write')];
  const state = snapshot({
    items, i: 1, day: DAY, done: { answered: 1, right: 1 },
    history: [{ item: items[0]!, rating: Rating.Good, typed: 'le bus',
      verdict: { verdict: 'ok' } }],
  });
  assert.deepEqual(state.ids, ['a|n|written|say', 'b|n|written|write']);
  assert.equal(state.i, 1);
  assert.deepEqual(state.history, [{ id: 'a|n|written|say', rating: Rating.Good, typed: 'le bus',
    verdict: { verdict: 'ok' } }]);
  assert.equal(state.done.answered, 1);
});

test('history comes back onto the cards it was about', () => {
  const items = [item('a|n|written|say'), item('b|n|written|write')];
  const rows: Partial<SavedHistoryRow>[] = [
    { id: cardIdOf('a|n|written|say'), rating: Rating.Hard, typed: '', verdict: null },
  ];
  assert.deepEqual(restoreHistory(rows, items),
    [{ item: items[0], rating: Rating.Hard, typed: '', verdict: null }]);
});

test('a card answered twice keeps its two answers apart', () => {
  /* An "Again" puts the card back at the end of the queue, so the same id can
     stand at two positions with two different answers. */
  const again = item('a|n|written|say');
  const items = [again, item('b|n|written|write'), again];
  const rows: Partial<SavedHistoryRow>[] = [
    { id: cardIdOf('a|n|written|say'), rating: Rating.Again, typed: 'wrong' },
    { id: cardIdOf('b|n|written|write'), rating: Rating.Good, typed: '' },
    { id: cardIdOf('a|n|written|say'), rating: Rating.Good, typed: 'right' },
  ];
  assert.deepEqual(restoreHistory(rows, items).map((h) => h.typed), ['wrong', '', 'right']);
});

test('history about a card no longer in the queue is dropped, not guessed at', () => {
  assert.deepEqual(
    restoreHistory([{ id: cardIdOf('gone|n|written|say'), rating: Rating.Good }],
      [item('a|n|written|say')]),
    []);
});
