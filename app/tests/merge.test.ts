/** Merging two devices' data: which copy wins, and what is worth writing back. */
import { Rating, State } from 'ts-fsrs';
import { expect, test } from 'vitest';

import { applyPull, collectPush, mergeCard, mergeReviews, mergeWord } from '../src/lib/merge';
import { emptyCard } from '../src/lib/scheduler';
import type { Card, Review, UserWord } from '../src/lib/types';

/** A card with every FSRS field filled, so a fixture names only the fields the
 *  merge actually compares. */
const card = (over: Partial<Card>): Card => ({
  ...emptyCard('a|noun', 'written', 'recognise'),
  ...over,
});

/** A review row with every required field filled. The merge is a union by
 *  `uid`, so `uid` and `ts` are all a fixture has to say. */
const review = (over: Partial<Review> & Pick<Review, 'uid'>): Review => ({
  id: 'a|noun|written|recognise',
  key: 'a|noun',
  direction: 'written/recognise',
  ts: 0,
  rating: Rating.Good,
  ms: null,
  state: State.Review,
  ...over,
});

/** A word record with every required field filled; only `updatedAt` and the
 *  tombstone decide a merge. */
const word = (over: Partial<UserWord> & Pick<UserWord, 'k'>): UserWord => ({
  fr: 'le natel',
  en: ['mobile phone'],
  pos: 'noun',
  ...over,
});

test('the more recently answered card wins', () => {
  const laptop = card({ id: 'a|fr_en', reps: 2, updatedAt: 100, last_review: new Date(100) });
  const phone = card({ id: 'a|fr_en', reps: 5, updatedAt: 900, last_review: new Date(900) });
  expect(mergeCard(laptop, phone)).toBe(phone);
  expect(mergeCard(phone, laptop)).toBe(phone);
});

test('a card missing on one side is taken from the other', () => {
  const c = card({ id: 'a|fr_en', updatedAt: 1 });
  expect(mergeCard(undefined, c)).toBe(c);
  expect(mergeCard(c, undefined)).toBe(c);
});

test('reviews union rather than overwrite, so nothing is lost offline', () => {
  const phone = [review({ uid: 'a', ts: 1 }), review({ uid: 'b', ts: 3 })];
  const laptop = [review({ uid: 'c', ts: 2 }), review({ uid: 'b', ts: 3 })];
  const merged = mergeReviews(phone, laptop);
  expect(merged.map((r) => r.uid)).toEqual(['a', 'c', 'b']);
});

test('merging reviews twice changes nothing', () => {
  const a = [review({ uid: 'a', ts: 1 })];
  const b = [review({ uid: 'b', ts: 2 })];
  const once = mergeReviews(a, b);
  expect(mergeReviews(once, b)).toEqual(once);
});

test('a deleted word stays deleted', () => {
  const kept = word({ k: 'natel|noun', updatedAt: 10 });
  const tombstone = word({ k: 'natel|noun', updatedAt: 20, deleted: true });
  expect(mergeWord(kept, tombstone)?.deleted).toBe(true);
  expect(mergeWord(tombstone, kept)?.deleted).toBe(true);
});

test('an edit after a deletion brings the word back', () => {
  const tombstone = word({ k: 'natel|noun', updatedAt: 20, deleted: true });
  const readded = word({ k: 'natel|noun', updatedAt: 30 });
  expect(mergeWord(tombstone, readded)?.deleted).toBe(undefined);
});

test('a pull reports what actually changed', () => {
  /** This device's own copies, as they stood when the round trip began. */
  const local = {
    localCards: [card({ id: 'a|fr_en', updatedAt: 5 })],
    localWords: [],
    localReviews: [review({ uid: 'r1', ts: 1 })],
  };
  const result = applyPull(local, {
    cards: [card({ id: 'a|fr_en', updatedAt: 50 }), card({ id: 'b|fr_en', updatedAt: 9 })],
    words: [word({ k: 'natel|noun', updatedAt: 3 })],
    reviews: [review({ uid: 'r1', ts: 1 }), review({ uid: 'r2', ts: 2 })],
  });
  expect(result.changed).toEqual({ cards: 2, words: 1, reviews: 1 });
  expect(result.reviews.length, 'the duplicate review is not added twice').toBe(2);
});

test('a pull names only the rows worth writing back', () => {
  /** A card the device holds a newer copy of than the pull carries. */
  const untouched = card({
    id: 'a|n|written|say',
    channel: 'written',
    rung: 'say',
    key: 'a|n',
    updatedAt: 500,
  });
  /** And one the pull is ahead of. */
  const older = card({
    id: 'b|n|written|say',
    channel: 'written',
    rung: 'say',
    key: 'b|n',
    updatedAt: 5,
  });
  const result = applyPull(
    {
      localCards: [untouched, older],
      localWords: [word({ k: 'w', updatedAt: 9 }), word({ k: 'v', updatedAt: 9 })],
      localReviews: [],
    },
    {
      cards: [
        { ...untouched, updatedAt: 100 },
        { ...older, updatedAt: 50 },
      ],
      words: [word({ k: 'w', updatedAt: 90 }), word({ k: 'v', updatedAt: 1 })],
    },
  );
  expect(
    result.touched.cards.map((c) => c.id),
    'the card the device has the newer copy of is left alone',
  ).toEqual(['b|n|written|say']);
  expect(result.touched.words.map((w) => w.k)).toEqual(['w']);
  expect(
    result.cards.length,
    'the full merged set is still there for anyone who wants it',
  ).toBe(2);
});

test('a rung retired by the pull is written back even though nothing else about it changed', () => {
  const low = card({
    id: 'a|n|written|recognise',
    channel: 'written',
    rung: 'recognise',
    key: 'a|n',
    updatedAt: 500,
    retired: false,
  });
  const result = applyPull(
    { localCards: [low], localWords: [], localReviews: [] },
    {
      cards: [
        card({
          id: 'a|n|written|say',
          channel: 'written',
          rung: 'say',
          key: 'a|n',
          updatedAt: 600,
        }),
      ],
    },
  );
  /** Each written-back card as its id and whether the merge retired it, in a
   *  settled order so the pair the test names is the pair it compares. */
  const retirements = result.touched.cards.map((c): [string, boolean] => [c.id, c.retired]);
  expect(retirements.sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
    ['a|n|written|recognise', true],
    ['a|n|written|say', false],
  ]);
});

test('a push carries only what the server has not seen', () => {
  const push = collectPush(
    {
      cards: [card({ id: 'a', updatedAt: 10 }), card({ id: 'b', updatedAt: 200 })],
      words: [word({ k: 'w', updatedAt: 300 })],
      reviews: [review({ uid: 'r1', synced: true }), review({ uid: 'r2' })],
      lessons: [],
    },
    100,
  );
  expect(push.cards.map((c) => c.id)).toEqual(['b']);
  expect(push.words.map((w) => w.k)).toEqual(['w']);
  expect(push.reviews.map((r) => r.uid)).toEqual(['r2']);
});
