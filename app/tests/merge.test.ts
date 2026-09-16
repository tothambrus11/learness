import { test } from 'vitest';
import assert from 'node:assert/strict';
import { applyPull, collectPush, mergeCard, mergeReviews, mergeWord } from '../src/lib/merge.js';
import { card, ms, review, sec, userWord } from './make.js';

test('the more recently answered card wins', () => {
  const laptop = card('a|noun', 'written', 'recognise',
    { reps: 2, updatedAt: ms(100), last_review: new Date(100) });
  const phone = card('a|noun', 'written', 'recognise',
    { reps: 5, updatedAt: ms(900), last_review: new Date(900) });
  assert.equal(mergeCard(laptop, phone), phone);
  assert.equal(mergeCard(phone, laptop), phone);
});

test('a card missing on one side is taken from the other', () => {
  const c = card('a|noun', 'written', 'recognise', { updatedAt: ms(1) });
  assert.equal(mergeCard(undefined, c), c);
  assert.equal(mergeCard(c, undefined), c);
});

test('reviews union rather than overwrite, so nothing is lost offline', () => {
  const phone = [review({ uid: 'a', ts: sec(1) }), review({ uid: 'b', ts: sec(3) })];
  const laptop = [review({ uid: 'c', ts: sec(2) }), review({ uid: 'b', ts: sec(3) })];
  const merged = mergeReviews(phone, laptop);
  assert.deepEqual(merged.map((r) => r.uid), ['a', 'c', 'b']);
});

test('merging reviews twice changes nothing', () => {
  const a = [review({ uid: 'a', ts: sec(1) })];
  const b = [review({ uid: 'b', ts: sec(2) })];
  const once = mergeReviews(a, b);
  assert.deepEqual(mergeReviews(once, b), once);
});

test('a deleted word stays deleted', () => {
  const kept = userWord({ updatedAt: ms(10) });
  const tombstone = userWord({ updatedAt: ms(20), deleted: true });
  assert.equal(mergeWord(kept, tombstone)?.deleted, true);
  assert.equal(mergeWord(tombstone, kept)?.deleted, true);
});

test('an edit after a deletion brings the word back', () => {
  const tombstone = userWord({ updatedAt: ms(20), deleted: true });
  const readded = userWord({ updatedAt: ms(30) });
  assert.equal(mergeWord(tombstone, readded)?.deleted, undefined);
});

test('a pull reports what actually changed', () => {
  const local = {
    localCards: [card('a|noun', 'written', 'recognise', { updatedAt: ms(5) })],
    localWords: [],
    localReviews: [review({ uid: 'r1', ts: sec(1) })],
  };
  const result = applyPull(local, {
    cards: [
      card('a|noun', 'written', 'recognise', { updatedAt: ms(50) }),
      card('b|noun', 'written', 'recognise', { updatedAt: ms(9) }),
    ],
    words: [userWord({ updatedAt: ms(3) })],
    reviews: [review({ uid: 'r1', ts: sec(1) }), review({ uid: 'r2', ts: sec(2) })],
  });
  assert.deepEqual(result.changed, { cards: 2, words: 1, reviews: 1, themes: 0 });
  assert.equal(result.reviews.length, 2, 'the duplicate review is not added twice');
});

test('a push carries only what the server has not seen', () => {
  const push = collectPush({
    cards: [
      card('a|noun', 'written', 'recognise', { updatedAt: ms(10) }),
      card('b|noun', 'written', 'recognise', { updatedAt: ms(200) }),
    ],
    words: [userWord({ k: 'w|noun', updatedAt: ms(300) })],
    reviews: [review({ uid: 'r1', synced: true }), review({ uid: 'r2' })],
    lessons: [],
  }, ms(100));
  assert.deepEqual(push.cards.map((c) => c.id), ['b|noun|written|recognise']);
  assert.deepEqual(push.words.map((w) => w.k), ['w|noun']);
  assert.deepEqual(push.reviews.map((r) => r.uid), ['r2']);
});

test('a pull laid over twice is the same as once, and the two sides commute', () => {
  /* Two devices offline for a week each push and pull in whichever order
     the network allows; what they end up with must not depend on it. */
  const local = {
    localCards: [card('bug|noun', 'written', 'write', { updatedAt: ms(2000), reps: 2 })],
    localWords: [userWord({ k: 'natel|noun', updatedAt: ms(1000) })],
    localReviews: [review({ uid: 'a', ts: sec(10) }), review({ uid: 'b', ts: sec(20) })],
  };
  const pull = {
    cards: [card('bug|noun', 'written', 'write', { updatedAt: ms(3000), reps: 3 }),
      card('jour|noun', 'written', 'recognise', { updatedAt: ms(500) })],
    words: [userWord({ k: 'natel|noun', updatedAt: ms(4000), note: 'theirs' })],
    reviews: [review({ uid: 'b', ts: sec(20) }), review({ uid: 'c', ts: sec(30) })],
  };
  const once = applyPull(local, pull);
  const twice = applyPull(
    { localCards: once.cards, localWords: once.words, localReviews: once.reviews }, pull);
  assert.deepEqual(twice.cards, once.cards);
  assert.deepEqual(twice.words, once.words);
  assert.deepEqual(twice.reviews, once.reviews);
  assert.deepEqual(twice.changed, { cards: 0, words: 0, reviews: 0, themes: 0 }, 'and nothing changed');

  /* The other way round: their side pulls ours. */
  const theirs = applyPull(
    { localCards: pull.cards, localWords: pull.words, localReviews: pull.reviews },
    { cards: local.localCards, words: local.localWords, reviews: local.localReviews });
  const byId = <T extends { id?: string; k?: string; uid?: string }>(xs: T[]): T[] =>
    [...xs].sort((a, b) => String(a.id ?? a.k ?? a.uid).localeCompare(String(b.id ?? b.k ?? b.uid)));
  assert.deepEqual(byId(theirs.cards), byId(once.cards), 'the same cards');
  assert.deepEqual(byId(theirs.words), byId(once.words), 'the same words');
  assert.deepEqual(theirs.reviews.map((r) => r.uid), once.reviews.map((r) => r.uid), 'the same log');
});
