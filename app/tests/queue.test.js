import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNTOUCHED_FOR, parseCardId, restoreHistory, resumable, snapshot, topUp }
  from '../src/lib/queue.js';

const item = (id) => ({ card: { id } });
const DAY = new Date('2026-09-10T09:00:00').setHours(0, 0, 0, 0);

test('a card id is read from the right, since the key holds a bar of its own', () => {
  assert.deepEqual(parseCardId('bus|noun|written|recognise'),
    { key: 'bus|noun', channel: 'written', rung: 'recognise' });
  assert.deepEqual(parseCardId('le bus|unknown|heard|dictate'),
    { key: 'le bus|unknown', channel: 'heard', rung: 'dictate' });
  assert.equal(parseCardId('nonsense'), null);
  assert.equal(parseCardId(undefined), null);
});

test('a sitting is carried on where it was left', () => {
  const saved = { ids: ['a|n|written|say', 'b|n|written|say'], i: 1, day: DAY };
  assert.equal(resumable(saved, { dayStart: DAY }), true);
  assert.equal(resumable({ ...saved, at: 0 }, { dayStart: DAY }), true,
    'started this morning and left for hours: still yours to finish');
});

test('a queue nobody started goes stale, since more falls due all day', () => {
  const now = DAY + 12 * 3600 * 1000;
  const dealt = { ids: ['a|n|written|say'], i: 0, day: DAY, at: now };
  assert.equal(resumable(dealt, { dayStart: DAY, now }), true, 'just dealt');
  assert.equal(resumable({ ...dealt, at: now - UNTOUCHED_FOR + 1000 }, { dayStart: DAY, now }), true);
  assert.equal(resumable({ ...dealt, at: now - UNTOUCHED_FOR - 1000 }, { dayStart: DAY, now }), false);
});

test('a sitting from another day, from the old walk, or already finished is not', () => {
  const saved = { ids: ['a|n|written|say'], i: 0, day: DAY };
  assert.equal(resumable(saved, { dayStart: DAY - 86400000 }), false, 'yesterday');
  assert.equal(resumable({ ...saved, walk: true }, { dayStart: DAY }), false,
    'a walk queue was dealt without the typed rungs');
  assert.equal(resumable({ ...saved, i: 1 }, { dayStart: DAY }), false, 'nothing left');
  assert.equal(resumable(null, { dayStart: DAY }), false);
  assert.equal(resumable({ ids: [], i: 0, day: DAY }, { dayStart: DAY }), false);
});

test('what is written down is ids and answers, not words', () => {
  const items = [item('a|n|written|say'), item('b|n|written|write')];
  const state = snapshot({
    items, i: 1, day: DAY, done: { answered: 1, right: 1 },
    history: [{ item: items[0], rating: 3, typed: 'le bus', verdict: { verdict: 'ok' } }],
  });
  assert.deepEqual(state.ids, ['a|n|written|say', 'b|n|written|write']);
  assert.equal(state.i, 1);
  assert.deepEqual(state.history, [{ id: 'a|n|written|say', rating: 3, typed: 'le bus',
    verdict: { verdict: 'ok' } }]);
  assert.equal(state.done.answered, 1);
});

test('history comes back onto the cards it was about', () => {
  const items = [item('a|n|written|say'), item('b|n|written|write')];
  const rows = [{ id: 'a|n|written|say', rating: 2, typed: '', verdict: null }];
  assert.deepEqual(restoreHistory(rows, items),
    [{ item: items[0], rating: 2, typed: '', verdict: null }]);
});

test('a card answered twice keeps its two answers apart', () => {
  /* An "Again" puts the card back at the end of the queue, so the same id can
     stand at two positions with two different answers. */
  const again = item('a|n|written|say');
  const items = [again, item('b|n|written|write'), again];
  const rows = [
    { id: 'a|n|written|say', rating: 1, typed: 'wrong' },
    { id: 'b|n|written|write', rating: 3, typed: '' },
    { id: 'a|n|written|say', rating: 3, typed: 'right' },
  ];
  assert.deepEqual(restoreHistory(rows, items).map((h) => h.typed), ['wrong', '', 'right']);
});

test('history about a card no longer in the queue is dropped, not guessed at', () => {
  assert.deepEqual(restoreHistory([{ id: 'gone|n|written|say', rating: 3 }], [item('a|n|written|say')]),
    []);
});

test('words added mid-sitting go in next, behind nothing already answered', () => {
  const items = [item('a|n|written|say'), item('b|n|written|write'), item('c|n|written|say')];
  const added = [item('mine|noun|written|recognise'), item('b|n|written|write')];
  const out = topUp(items, 1, added);
  assert.deepEqual(out.map((it) => it.card.id), [
    'a|n|written|say', 'mine|noun|written|recognise', 'b|n|written|write', 'c|n|written|say',
  ]);
  assert.equal(topUp(items, 1, []), items, 'nothing to add: the same queue');
  assert.equal(topUp(items, 1, [item('b|n|written|write')]), items, 'already queued: unchanged');
  /* The answered cards are exactly where the history expects them. */
  const rows = [{ id: 'a|n|written|say', rating: 3 }];
  assert.equal(restoreHistory(rows, out)[0].item, items[0]);
});
