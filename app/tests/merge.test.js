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
