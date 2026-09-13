import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Rating, State } from 'ts-fsrs';
import type { Review } from '../src/lib/model.js';
import { secOf, trustMs } from '../src/lib/units.js';
import type { Seconds } from '../src/lib/units.js';
import { id as cardIdOf, ms, review as made, sec, settings as madeSettings } from './make.js';
import {
  DAY, comparison, dailyCounts, dayContract, dayStart, humanMinutes, metOn, streak,
  summariseDay,
} from '../src/lib/progress.js';

/* A fixed afternoon, so the tests do not drift with the clock. */
const NOON = new Date(2026, 8, 5, 12, 0, 0);
const at = (hour: number, minute = 0): Seconds =>
  secOf(trustMs(new Date(2026, 8, 5, hour, minute, 0).getTime()));

/** A review of the same card at nine in the morning, unless the test says
 *  otherwise. `direction` stays the pre-ladder spelling on purpose: the log
 *  is historical, and these rows are what an old day looks like. */
const review = (over: Omit<Partial<Review>, 'key'> & { key?: string } = {}): Review =>
  made({ direction: 'fr_en', ts: at(9), rating: Rating.Good, ms: 3000, state: State.Review,
    ...over });

test('a day runs from local midnight, not from midnight UTC', () => {
  const start = dayStart(NOON);
  assert.equal(new Date(start).getHours(), 0);
  assert.equal(new Date(start).getDate(), 5);
});

test('yesterday evening and this morning are different days', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ ts: sec(at(0) - 600)}),        /* 23:50 yesterday */
      review({ ts: sec(at(0) + 600)}),        /* 00:10 today */
    ],
  });
  assert.equal(day.reviews, 1);
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
  assert.equal(day.reviews, 3);
  assert.equal(day.minutes, 0.2);
  assert.equal(day.hourly[7], 2);
  assert.equal(day.hourly[11], 1);
  assert.equal(day.hourly[12], 0);
  assert.equal(new Date(day.firstAt ?? 0).getHours(), 7);
  assert.equal(new Date(day.lastAt ?? 0).getHours(), 11);
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
  assert.equal(day.recalled, 3);
  assert.equal(day.accuracy, 2 / 3);
  assert.deepEqual(day.counts, { again: 2, hard: 0, good: 1, easy: 1 });
});

test('a day with nothing to recall has no accuracy rather than zero', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [review({ state: State.New, rating: Rating.Again })],
  });
  assert.equal(day.accuracy, null);
  assert.equal(day.reviews, 1);
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
  assert.deepEqual(day.met, ['natel|noun', 'héros|noun']);
});

test('a rung opened on a word met long ago is not a word met today', () => {
  /* A promotion makes a new card, and a new card's first answer is State.New.
     Counting that as a new word was how a day claimed to have met words it had
     known for weeks — and, worse, how the day's new-word allowance was spent
     on the wrong thing. The log says which it was. */
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ key: 'vieux|adj', ts: sec(at(9) - DAY / 1000), state: State.Review }),
      review({ key: 'vieux|adj', state: State.New, met: false }),
      review({ key: 'natel|noun', state: State.New, met: true }),
    ],
  });
  assert.deepEqual(day.met, ['natel|noun']);
});

test('words met today are what the new-word allowance has spent', () => {
  const reviews = [
    /* met yesterday, back today: not a new word */
    review({ key: 'vieux|adj', ts: sec(at(9) - DAY / 1000), state: State.New, met: true }),
    review({ key: 'vieux|adj', ts: at(10), state: State.Learning, met: false }),
    /* met this morning, failed and answered again: one word, once */
    review({ key: 'natel|noun', ts: at(8), state: State.New, met: true }),
    review({ key: 'natel|noun', ts: at(8, 5), state: State.Learning, met: false }),
    review({ key: 'héros|noun', ts: at(11), state: State.New, met: true }),
  ];
  assert.deepEqual(metOn(reviews, { at: NOON }), ['natel|noun', 'héros|noun']);
});

test('a day logged before first meetings were written down still counts them', () => {
  const reviews = [
    review({ key: 'vieux|adj', ts: sec(at(9) - DAY / 1000), state: State.New }),
    review({ key: 'vieux|adj', ts: at(10), state: State.New }),
    review({ key: 'natel|noun', ts: at(8), state: State.New }),
  ];
  assert.deepEqual(metOn(reviews, { at: NOON }), ['natel|noun'],
    'a word with a history behind it was not met today');
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
  assert.equal(day.learned, 2);
});

test('a day whose reviews predate the record says so instead of zero', () => {
  const day = summariseDay({ at: NOON, reviews: [review(), review()] });
  assert.equal(day.learned, null, 'nobody was counting is not the same as none');
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
  assert.deepEqual(day.byDirection, [
    { direction: 'fr_en', reviews: 2, right: 1, recalled: 2 },
    { direction: 'written/say', reviews: 1, right: 1, recalled: 1 },
  ]);
});

test('words that climbed a rung are counted from the log, and unknown before it', () => {
  assert.equal(summariseDay({ at: NOON, reviews: [review()] }).promoted, null);
  const day = summariseDay({
    at: NOON,
    reviews: [review({ promoted: 'say' }), review({ promoted: null }), review({ promoted: 'write' })],
  });
  assert.equal(day.promoted, 2);
});

test('the run-up is one bar per day, oldest first, today last', () => {
  const days = dailyCounts([
    review({ ts: at(9) }),
    review({ ts: at(10) }),
    review({ ts: sec(at(9) - 2 * 86400)}),
  ], { days: 5, at: NOON });
  assert.equal(days.length, 5);
  assert.deepEqual(days.map((d) => d.reviews), [0, 0, 1, 0, 2]);
  assert.equal(days[4]?.date, dayStart(NOON));
});

test('a streak counts back from today, and a fresh morning does not break it', () => {
  const yesterday = review({ ts: sec(at(9) - 86400)});
  const before = review({ ts: sec(at(9) - 2 * 86400)});
  assert.equal(streak([review(), yesterday, before], NOON), 3);
  assert.equal(streak([yesterday, before], NOON), 2, 'today is still ahead of you');
  assert.equal(streak([before], NOON), 0, 'a missed yesterday ends it');
  assert.equal(streak([], NOON), 0);
});

test('today is compared with the days that had work in them', () => {
  const history = [
    { date: ms(0), reviews: 10, minutes: 0 }, { date: ms(DAY), reviews: 20, minutes: 0 },
    { date: ms(2 * DAY), reviews: 0, minutes: 0 }, { date: ms(3 * DAY), reviews: 30, minutes: 0 },
    { date: ms(4 * DAY), reviews: 30, minutes: 0 },
  ];
  const c = comparison(history);
  assert.equal(c!.mean, 20);
  assert.equal(c!.today, 30);
  assert.equal(c!.ratio, 1.5);
  assert.equal(comparison(history.slice(-2)), null, 'too little to compare with');
});

test('the debt counts a card once, however many times relearning brought it back', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [
      review({ id: cardIdOf('bug|noun|fr_en'), rating: Rating.Again }),
      review({ id: cardIdOf('bug|noun|fr_en'), rating: Rating.Good, state: State.Relearning }),
      review({ id: cardIdOf('eau|noun|fr_en'), key: 'eau|noun' }),
      review({ id: cardIdOf('natel|noun|fr_en'), key: 'natel|noun', state: State.New }),
    ],
  });
  assert.equal(day.dueAnswered, 2, 'a new word is not a debt');
});

test('a mispronunciation is counted, not graded', () => {
  const day = summariseDay({
    at: NOON,
    reviews: [review({ mispronounced: true }), review(), review({ mispronounced: true })],
  });
  assert.equal(day.mispronounced, 2);
  assert.equal(day.accuracy, 1, 'saying it wrong did not touch the rating');
});

const settings = madeSettings({ targetReviews: 120, maxNewPerDay: 20, costPerNewWord: 2.5 });

test('the day is done when the debt is cleared and the allowance is taken', () => {
  const c = dayContract({ dueRemaining: 0, reviewedToday: 37, metToday: 12,
    retention7d: 0.93, settings });
  assert.deepEqual(c!.debt, { done: 37, target: 37, remaining: 0 });
  /* 37 due at the start of the day leaves room for (120 - 37) / 2.5 = 33,
     clamped to the ceiling of 20; 12 of those were taken. */
  assert.deepEqual(c!.gain, { done: 12, target: 20, remaining: 8 });
  assert.equal(c!.complete, false, 'eight new words still owed');
  assert.equal(dayContract({ dueRemaining: 0, reviewedToday: 37, metToday: 20,
    retention7d: 0.93, settings })!.complete, true);
});

test('the plan does not shrink as you clear it', () => {
  const morning = dayContract({ dueRemaining: 40, reviewedToday: 0, metToday: 0,
    retention7d: null, settings });
  const evening = dayContract({ dueRemaining: 10, reviewedToday: 30, metToday: 0,
    retention7d: null, settings });
  assert.equal(morning!.debt.target, 40);
  assert.equal(evening!.debt.target, 40, 'the same 40 you woke up to');
  assert.equal(evening!.debt.remaining, 10);
  assert.equal(morning!.gain.target, evening!.gain.target);
});

test('a heavy day is capped at what you said you were happy to do', () => {
  const c = dayContract({ dueRemaining: 300, reviewedToday: 0, metToday: 0,
    retention7d: null, settings });
  assert.equal(c!.debt.target, 120);
  assert.equal(c!.gain.target, 0, 'no room for new words on a day like that');
});

test('poor recall this week takes the new words off the plan, and the plan says so', () => {
  const c = dayContract({ dueRemaining: 20, reviewedToday: 0, metToday: 0,
    retention7d: 0.8, settings });
  assert.equal(c!.gain.target, 0);
  assert.equal(c!.complete, false, 'the debt is still there');
  assert.equal(dayContract({ dueRemaining: 0, reviewedToday: 20, metToday: 0,
    retention7d: 0.8, settings })!.complete, true, 'and once it is paid, that is the day');
});

test('no settings, no contract', () => {
  assert.equal(dayContract({ dueRemaining: 5, reviewedToday: 0, metToday: 0,
    retention7d: null, settings: null }), null);
});

test('minutes are read the way a person would say them', () => {
  assert.equal(humanMinutes(0), '0 min');
  assert.equal(humanMinutes(0.4), '<1 min');
  assert.equal(humanMinutes(12.6), '13 min');
  assert.equal(humanMinutes(60), '1 h');
  assert.equal(humanMinutes(95), '1 h 35 min');
});
