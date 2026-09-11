/** What today looked like, read back out of the review log. */
import { Rating, State } from 'ts-fsrs';
import { expect, test } from 'vitest';

import {
  comparison,
  dailyCounts,
  DAY,
  dayContract,
  dayStart,
  humanMinutes,
  metToday,
  streak,
  summariseDay,
} from '../src/lib/progress';
import type { DailyCount } from '../src/lib/progress';
import type { Review, Settings } from '../src/lib/types';

/* A fixed afternoon, so the tests do not drift with the clock. */
const NOON = new Date(2026, 8, 5, 12, 0, 0);

/** A moment on that same day, as the log stores it: unix **seconds**. */
const at = (hour: number, minute: number = 0): number =>
  Math.floor(new Date(2026, 8, 5, hour, minute, 0).getTime() / 1000);

/** One answer, given at nine this morning unless a test says otherwise.
 *
 *  Deliberately carries no `learned` and no `promoted` key: their absence is
 *  what tells a day nobody was counting from a day nothing happened on.
 */
const review = (over: Partial<Review> = {}): Review => ({
  uid: 'r',
  id: 'bug|noun|fr_en',
  key: 'bug|noun',
  direction: 'fr_en',
  ts: at(9),
  rating: Rating.Good,
  ms: 3000,
  state: State.Review,
  ...over,
});

/** One bar of the run-up, as `comparison()` reads it: only the answer count
 *  is compared, so the minutes are filler. */
const bar = (date: number, reviews: number): DailyCount => ({ date, reviews, minutes: 0 });

test('a day runs from local midnight, not from midnight UTC', () => {
  const start = dayStart(NOON);
  expect(new Date(start).getHours()).toBe(0);
  expect(new Date(start).getDate()).toBe(5);
});

test('yesterday evening and this morning are different days', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ ts: at(0) - 600 }) /* 23:50 yesterday */,
      review({ ts: at(0) + 600 }) /* 00:10 today */,
    ],
  });
  expect(day.reviews).toBe(1);
});

test('the day counts answers, time and when the work happened', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ ts: at(7, 30), ms: 4000 }),
      review({ ts: at(7, 45), ms: 2000 }),
      review({ ts: at(11), ms: 6000 }),
    ],
  });
  expect(day.reviews).toBe(3);
  expect(day.minutes).toBe(0.2);
  expect(day.hourly[7]).toBe(2);
  expect(day.hourly[11]).toBe(1);
  expect(day.hourly[12]).toBe(0);
  expect(new Date(day.firstAt!).getHours()).toBe(7);
  expect(new Date(day.lastAt!).getHours()).toBe(11);
});

test('recall is measured over memories, not over first meetings', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ rating: Rating.Again }),
      review({ rating: Rating.Good }),
      review({ rating: Rating.Easy }),
      /* A brand new word answered badly is not a failure of memory. */
      review({ rating: Rating.Again, state: State.New, key: 'natel|noun' }),
    ],
  });
  expect(day.recalled).toBe(3);
  expect(day.accuracy).toBe(2 / 3);
  expect(day.counts).toEqual({ again: 2, hard: 0, good: 1, easy: 1 });
});

test('a day with nothing to recall has no accuracy rather than zero', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [review({ state: State.New, rating: Rating.Again })],
  });
  expect(day.accuracy).toBe(null);
  expect(day.reviews).toBe(1);
});

test('words met today are the first sightings, counted once each', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ key: 'natel|noun', state: State.New }),
      review({ key: 'natel|noun', state: State.Learning }),
      review({ key: 'héros|noun', state: State.New }),
      review({ key: 'bug|noun', state: State.Review }),
    ],
  });
  expect(day.met).toEqual(['natel|noun', 'héros|noun']);
});

test('words that became known are counted from the log, not guessed', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ learned: true }),
      review({ learned: false }),
      review({ learned: true, key: 'eau|noun' }),
    ],
  });
  expect(day.learned).toBe(2);
});

test('a day whose reviews predate the record says so instead of zero', () => {
  const day = summariseDay({ at: NOON, reviews: [review(), review()] });
  expect(day.learned, 'nobody was counting is not the same as none').toBe(null);
});

test('each exercise keeps its own score, old directions and rungs alike', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ direction: 'fr_en', rating: Rating.Good }),
      review({ direction: 'fr_en', rating: Rating.Again }),
      review({ direction: 'written/say', rating: Rating.Good }),
    ],
  });
  expect(day.byDirection).toEqual([
    { direction: 'fr_en', reviews: 2, right: 1, recalled: 2 },
    { direction: 'written/say', reviews: 1, right: 1, recalled: 1 },
  ]);
});

test('words that climbed a rung are counted from the log, and unknown before it', () => {
  expect(summariseDay({ at: NOON, reviews: [review()] }).promoted).toBe(null);
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ promoted: 'say' }),
      review({ promoted: null }),
      review({ promoted: 'write' }),
    ],
  });
  expect(day.promoted).toBe(2);
});

test('the run-up is one bar per day, oldest first, today last', () => {
  const days = dailyCounts(
    [review({ ts: at(9) }), review({ ts: at(10) }), review({ ts: at(9) - 2 * 86400 })],
    { days: 5, at: NOON },
  );
  expect(days.length).toBe(5);
  expect(days.map((d) => d.reviews)).toEqual([0, 0, 1, 0, 2]);
  expect(days[4].date).toBe(dayStart(NOON));
});

test('a streak counts back from today, and a fresh morning does not break it', () => {
  const yesterday = review({ ts: at(9) - 86400 });
  const before = review({ ts: at(9) - 2 * 86400 });
  expect(streak([review(), yesterday, before], NOON)).toBe(3);
  expect(streak([yesterday, before], NOON), 'today is still ahead of you').toBe(2);
  expect(streak([before], NOON), 'a missed yesterday ends it').toBe(0);
  expect(streak([], NOON)).toBe(0);
});

test('today is compared with the days that had work in them', () => {
  /** Five days, one of them empty, with today the busiest. */
  const history = [
    bar(0, 10),
    bar(DAY, 20),
    bar(2 * DAY, 0),
    bar(3 * DAY, 30),
    bar(4 * DAY, 30),
  ];
  const c = comparison(history);
  expect(c?.mean).toBe(20);
  expect(c?.today).toBe(30);
  expect(c?.ratio).toBe(1.5);
  expect(comparison(history.slice(-2)), 'too little to compare with').toBe(null);
});

test('the debt counts a card once, however many times relearning brought it back', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ id: 'bug|noun|fr_en', rating: Rating.Again }),
      review({ id: 'bug|noun|fr_en', rating: Rating.Good, state: State.Relearning }),
      review({ id: 'eau|noun|fr_en', key: 'eau|noun' }),
      review({ id: 'natel|noun|fr_en', key: 'natel|noun', state: State.New }),
    ],
  });
  expect(day.dueAnswered, 'a new word is not a debt').toBe(2);
});

test('a mispronunciation is counted, not graded', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [review({ mispronounced: true }), review(), review({ mispronounced: true })],
  });
  expect(day.mispronounced).toBe(2);
  expect(day.accuracy, 'saying it wrong did not touch the rating').toBe(1);
});

/** The budget and the ceiling the day's finish line is worked out from. */
const settings: Pick<Settings, 'targetReviews' | 'maxNewPerDay' | 'costPerNewWord'> = {
  targetReviews: 120,
  maxNewPerDay: 20,
  costPerNewWord: 2.5,
};

test('the day is done when the debt is cleared and the allowance is taken', () => {
  const c = dayContract({
    dueRemaining: 0,
    reviewedToday: 37,
    metToday: 12,
    retention7d: 0.93,
    settings,
  });
  expect(c?.debt).toEqual({ done: 37, target: 37, remaining: 0 });
  /* 37 due at the start of the day leaves room for (120 - 37) / 2.5 = 33,
     clamped to the ceiling of 20; 12 of those were taken. */
  expect(c?.gain).toEqual({ done: 12, target: 20, remaining: 8 });
  expect(c?.complete, 'eight new words still owed').toBe(false);
  expect(
    dayContract({
      dueRemaining: 0,
      reviewedToday: 37,
      metToday: 20,
      retention7d: 0.93,
      settings,
    })?.complete,
  ).toBe(true);
});

test('the plan does not shrink as you clear it', () => {
  const morning = dayContract({
    dueRemaining: 40,
    reviewedToday: 0,
    metToday: 0,
    retention7d: null,
    settings,
  });
  const evening = dayContract({
    dueRemaining: 10,
    reviewedToday: 30,
    metToday: 0,
    retention7d: null,
    settings,
  });
  expect(morning?.debt.target).toBe(40);
  expect(evening?.debt.target, 'the same 40 you woke up to').toBe(40);
  expect(evening?.debt.remaining).toBe(10);
  expect(morning?.gain.target).toBe(evening?.gain.target);
});

test('a heavy day is capped at what you said you were happy to do', () => {
  const c = dayContract({
    dueRemaining: 300,
    reviewedToday: 0,
    metToday: 0,
    retention7d: null,
    settings,
  });
  expect(c?.debt.target).toBe(120);
  expect(c?.gain.target, 'no room for new words on a day like that').toBe(0);
});

test('poor recall this week takes the new words off the plan, and the plan says so', () => {
  const c = dayContract({
    dueRemaining: 20,
    reviewedToday: 0,
    metToday: 0,
    retention7d: 0.8,
    settings,
  });
  expect(c?.gain.target).toBe(0);
  expect(c?.complete, 'the debt is still there').toBe(false);
  expect(
    dayContract({ dueRemaining: 0, reviewedToday: 20, metToday: 0, retention7d: 0.8, settings })
      ?.complete,
    'and once it is paid, that is the day',
  ).toBe(true);
});

test('no settings, no contract', () => {
  expect(
    dayContract({
      dueRemaining: 5,
      reviewedToday: 0,
      metToday: 0,
      retention7d: null,
      settings: null,
    }),
  ).toBe(null);
});

test('minutes are read the way a person would say them', () => {
  expect(humanMinutes(0)).toBe('0 min');
  expect(humanMinutes(0.4)).toBe('<1 min');
  expect(humanMinutes(12.6)).toBe('13 min');
  expect(humanMinutes(60)).toBe('1 h');
  expect(humanMinutes(95)).toBe('1 h 35 min');
});

test('words met today are counted once each, and only first exposures count', () => {
  const rows = [
    review({ key: 'a|noun', state: State.New, ts: at(9) }),
    review({ key: 'a|noun', state: State.Review, ts: at(9, 20) }) /* its second look */,
    review({ key: 'b|noun', state: State.New, ts: at(10) }),
    review({ key: 'c|noun', state: State.New, ts: at(0) - 600 }) /* yesterday */,
    review({ key: 'd|noun', state: State.Review, ts: at(11) }) /* an old word */,
  ];
  expect(metToday(rows, NOON)).toBe(2);
});
