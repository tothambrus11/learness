import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPull, collectPush, mergeCard, mergeReviews, mergeWord } from '../src/lib/merge.js';

test('the more recently answered card wins', () => {
  const laptop = { id: 'a|fr_en', reps: 2, updatedAt: 100, last_review: new Date(100) };
  const phone = { id: 'a|fr_en', reps: 5, updatedAt: 900, last_review: new Date(900) };
  assert.equal(mergeCard(laptop, phone), phone);
  assert.equal(mergeCard(phone, laptop), phone);
});

test('a card missing on one side is taken from the other', () => {
  const c = { id: 'a|fr_en', updatedAt: 1 };
  assert.equal(mergeCard(null, c), c);
  assert.equal(mergeCard(c, null), c);
});

test('reviews union rather than overwrite, so nothing is lost offline', () => {
  const phone = [{ uid: 'a', ts: 1 }, { uid: 'b', ts: 3 }];
  const laptop = [{ uid: 'c', ts: 2 }, { uid: 'b', ts: 3 }];
  const merged = mergeReviews(phone, laptop);
  assert.deepEqual(merged.map((r) => r.uid), ['a', 'c', 'b']);
});

test('merging reviews twice changes nothing', () => {
  const a = [{ uid: 'a', ts: 1 }];
  const b = [{ uid: 'b', ts: 2 }];
  const once = mergeReviews(a, b);
  assert.deepEqual(mergeReviews(once, b), once);
});

test('a deleted word stays deleted', () => {
  const kept = { k: 'natel|noun', updatedAt: 10 };
  const tombstone = { k: 'natel|noun', updatedAt: 20, deleted: true };
  assert.equal(mergeWord(kept, tombstone).deleted, true);
  assert.equal(mergeWord(tombstone, kept).deleted, true);
});

test('an edit after a deletion brings the word back', () => {
  const tombstone = { k: 'natel|noun', updatedAt: 20, deleted: true };
  const readded = { k: 'natel|noun', updatedAt: 30 };
  assert.equal(mergeWord(tombstone, readded).deleted, undefined);
});

test('a pull reports what actually changed', () => {
  const local = {
    localCards: [{ id: 'a|fr_en', updatedAt: 5 }],
    localWords: [],
    localReviews: [{ uid: 'r1', ts: 1 }],
  };
  const result = applyPull(local, {
    cards: [{ id: 'a|fr_en', updatedAt: 50 }, { id: 'b|fr_en', updatedAt: 9 }],
    words: [{ k: 'natel|noun', updatedAt: 3 }],
    reviews: [{ uid: 'r1', ts: 1 }, { uid: 'r2', ts: 2 }],
  });
  assert.deepEqual(result.changed, { cards: 2, words: 1, reviews: 1 });
  assert.equal(result.reviews.length, 2, 'the duplicate review is not added twice');
});

test('a pull names only the rows worth writing back', () => {
  const untouched = { id: 'a|n|written|say', channel: 'written', rung: 'say', key: 'a|n', updatedAt: 500 };
  const older = { id: 'b|n|written|say', channel: 'written', rung: 'say', key: 'b|n', updatedAt: 5 };
  const result = applyPull({
    localCards: [untouched, older],
    localWords: [{ k: 'w', updatedAt: 9 }, { k: 'v', updatedAt: 9 }],
    localReviews: [],
  }, {
    cards: [{ ...untouched, updatedAt: 100 }, { ...older, updatedAt: 50 }],
    words: [{ k: 'w', updatedAt: 90 }, { k: 'v', updatedAt: 1 }],
  });
  assert.deepEqual(result.touched.cards.map((c) => c.id), ['b|n|written|say'],
    'the card the device has the newer copy of is left alone');
  assert.deepEqual(result.touched.words.map((w) => w.k), ['w']);
  assert.equal(result.cards.length, 2, 'the full merged set is still there for anyone who wants it');
});

test('a rung retired by the pull is written back even though nothing else about it changed', () => {
  const low = { id: 'a|n|written|recognise', channel: 'written', rung: 'recognise', key: 'a|n',
    updatedAt: 500, retired: false };
  const result = applyPull({ localCards: [low], localWords: [], localReviews: [] }, {
    cards: [{ id: 'a|n|written|say', channel: 'written', rung: 'say', key: 'a|n', updatedAt: 600 }],
  });
  assert.deepEqual(result.touched.cards.map((c) => [c.id, !!c.retired]).sort(), [
    ['a|n|written|recognise', true], ['a|n|written|say', false],
  ]);
});

test('a push carries only what the server has not seen', () => {
  const push = collectPush({
    cards: [{ id: 'a', updatedAt: 10 }, { id: 'b', updatedAt: 200 }],
    words: [{ k: 'w', updatedAt: 300 }],
    reviews: [{ uid: 'r1', synced: true }, { uid: 'r2' }],
    lessons: [],
  }, 100);
  assert.deepEqual(push.cards.map((c) => c.id), ['b']);
  assert.deepEqual(push.words.map((w) => w.k), ['w']);
  assert.deepEqual(push.reviews.map((r) => r.uid), ['r2']);
});
