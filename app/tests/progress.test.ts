import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Rating, State } from 'ts-fsrs';
import type { Review } from '../src/lib/model.js';
import type { CardId } from '../src/lib/keys.js';
import { secOf, trustMs } from '../src/lib/units.js';
import type { Seconds } from '../src/lib/units.js';
import { card, id as cardIdOf, ms, review as made, sec, settings as madeSettings } from './make.js';
import { owedNow } from '../src/lib/plan.js';
import {
  DAY, DEFAULT_DAY_STARTS_AT, comparison, dailyCounts, dayContract, dayStart, humanMinutes, metOn,
  streak, summariseDay,
} from '../src/lib/progress.js';

/* A fixed afternoon, so the tests do not drift with the clock. */
const NOON = new Date(2026, 8, 5, 12, 0, 0);
/* The day turns at the default hour unless a test is about the hour. */
const HOUR = DEFAULT_DAY_STARTS_AT;
const at = (hour: number, minute = 0): Seconds =>
  secOf(trustMs(new Date(2026, 8, 5, hour, minute, 0).getTime()));

/** A review of the same card at nine in the morning, unless the test says
 *  otherwise. `direction` stays the pre-ladder spelling on purpose: the log
 *  is historical, and these rows are what an old day looks like. */
const review = (over: Omit<Partial<Review>, 'key'> & { key?: string } = {}): Review =>
  made({ direction: 'fr_en', ts: at(9), rating: Rating.Good, ms: 3000, state: State.Review,
    ...over });

test('a sitting at half past midnight belongs to the evening before, until the hour the day turns', () => {
  /* Expectations are built on the local calendar, `new Date(y, m, d, h)`,
     never by adding a day of milliseconds: across a clock change the two
     differ by an hour, and the day still has to begin at the hour. */
  const local = (d: number, h: number): number => new Date(2026, 8, d, h).getTime();
  const table: [at: Date, startsAt: number, began: number, why: string][] = [
    [new Date(2026, 8, 5, 2, 30), 3, local(4, 3), 'before the hour: the day began yesterday at three'],
    [new Date(2026, 8, 5, 0, 0), 3, local(4, 3), 'midnight is the evening’s, too'],
    [new Date(2026, 8, 5, 2, 59, 59), 3, local(4, 3), 'to the last second before'],
    [new Date(2026, 8, 5, 3, 0), 3, local(5, 3), 'at the hour exactly: today has just begun'],
    [new Date(2026, 8, 5, 12), 3, local(5, 3), 'after it: today, at the hour'],
    [new Date(2026, 8, 5, 23, 59), 3, local(5, 3), 'right up to the small hours'],
    [new Date(2026, 8, 5, 0, 10), 0, local(5, 0), 'zero is midnight, where the day used to turn'],
    [new Date(2026, 8, 5, 23, 59), 0, local(5, 0), 'and at midnight the whole calendar day is one'],
    [new Date(2026, 8, 5, 21), 22, local(4, 22), 'a late hour, for someone who sits down after the news'],
    [new Date(2026, 8, 5, 22), 22, local(5, 22), 'is fine as well'],
  ];
  for (const [when, startsAt, began, why] of table) {
    assert.equal(dayStart(when, startsAt), began, why);
  }
  /* The step back is by the calendar: the first of the month at one in the
     morning began on the last day of the month before. */
  assert.equal(dayStart(new Date(2026, 9, 1, 1), 3), new Date(2026, 8, 30, 3).getTime());
});

test('a day turns on the local clock, not at a UTC hour', () => {
  const start = dayStart(NOON, HOUR);
  assert.equal(new Date(start).getHours(), HOUR);
  assert.equal(new Date(start).getDate(), 5);
});

test('a stored hour that is not one turns the day at three rather than nowhere', () => {
  /* The dial is clamped on the way in, but a row can be hand-edited, and a
     day that turned at "NaN o'clock" would be no day at all. */
  const three = dayStart(NOON, 3);
  assert.equal(dayStart(NOON, Number.NaN), three);
  assert.equal(dayStart(NOON, 24), three);
  assert.equal(dayStart(NOON, -1), three);
  assert.equal(dayStart(NOON, 2.5), dayStart(NOON, 2), 'a fraction is the hour it falls in');
});

test('ten past midnight is still last night; ten past three is this morning', () => {
  /* The day turned at midnight once, and a sitting that ran a few minutes
     past twelve saw its tally start again under the learner's hands (#70). */
  const reviews = [
    review({ ts: sec(at(0) - 600) }),        /* 23:50 yesterday */
    review({ ts: sec(at(0) + 600) }),        /* 00:10: the same evening */
    review({ ts: at(3, 10) }),               /* 03:10: today's first */
    review({ ts: at(9) }),
  ];
  assert.equal(summariseDay({ at: NOON, dayStartsAt: HOUR, reviews }).reviews, 2);
  assert.equal(summariseDay({ at: NOON, dayStartsAt: 0, reviews }).reviews, 3,
    'with the day turning at midnight, as it used to, the old rule holds');
  assert.equal(summariseDay({ at: new Date(2026, 8, 5, 1), dayStartsAt: HOUR, reviews }).reviews, 2,
    'and asked at one in the morning, today is still last night');
});

test('the day counts answers, time and when the work happened', () => {
  const day = summariseDay({
    at: NOON, dayStartsAt: HOUR,
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
    at: NOON, dayStartsAt: HOUR,
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
    at: NOON, dayStartsAt: HOUR,
    reviews: [review({ state: State.New, rating: Rating.Again })],
  });
  assert.equal(day.accuracy, null);
  assert.equal(day.reviews, 1);
});

test('words met today are the first sightings, counted once each', () => {
  const day = summariseDay({
    at: NOON, dayStartsAt: HOUR,
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
    at: NOON, dayStartsAt: HOUR,
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
  assert.deepEqual(metOn(reviews, { at: NOON, dayStartsAt: HOUR }), ['natel|noun', 'héros|noun']);
});

test('a day logged before first meetings were written down still counts them', () => {
  const reviews = [
    review({ key: 'vieux|adj', ts: sec(at(9) - DAY / 1000), state: State.New }),
    review({ key: 'vieux|adj', ts: at(10), state: State.New }),
    review({ key: 'natel|noun', ts: at(8), state: State.New }),
  ];
  assert.deepEqual(metOn(reviews, { at: NOON, dayStartsAt: HOUR }), ['natel|noun'],
    'a word with a history behind it was not met today');
});

test('words that became known are counted from the log, not guessed', () => {
  const day = summariseDay({
    at: NOON, dayStartsAt: HOUR,
    reviews: [
      review({ learned: true }),
      review({ learned: false }),
      review({ learned: true, key: 'eau|noun' }),
    ],
  });
  assert.equal(day.learned, 2);
});

test('a day whose reviews predate the record says so instead of zero', () => {
  const day = summariseDay({ at: NOON, dayStartsAt: HOUR, reviews: [review(), review()] });
  assert.equal(day.learned, null, 'nobody was counting is not the same as none');
});

test('each exercise keeps its own score, old directions and rungs alike', () => {
  const day = summariseDay({
    at: NOON, dayStartsAt: HOUR,
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
  assert.equal(summariseDay({ at: NOON, dayStartsAt: HOUR, reviews: [review()] }).promoted, null);
  const day = summariseDay({
    at: NOON, dayStartsAt: HOUR,
    reviews: [review({ promoted: 'say' }), review({ promoted: null }), review({ promoted: 'write' })],
  });
  assert.equal(day.promoted, 2);
});

test('the run-up is one bar per day, oldest first, today last', () => {
  const days = dailyCounts([
    review({ ts: at(9) }),
    review({ ts: at(10) }),
    review({ ts: sec(at(9) - 2 * 86400)}),
  ], { days: 5, at: NOON, dayStartsAt: HOUR });
  assert.equal(days.length, 5);
  assert.deepEqual(days.map((d) => d.reviews), [0, 0, 1, 0, 2]);
  assert.equal(days[4]?.date, dayStart(NOON, HOUR));
});

test('a streak counts back from today, and a fresh morning does not break it', () => {
  const yesterday = review({ ts: sec(at(9) - 86400)});
  const before = review({ ts: sec(at(9) - 2 * 86400)});
  assert.equal(streak([review(), yesterday, before], { at: NOON, dayStartsAt: HOUR }), 3);
  assert.equal(streak([yesterday, before], { at: NOON, dayStartsAt: HOUR }), 2, 'today is still ahead of you');
  assert.equal(streak([before], { at: NOON, dayStartsAt: HOUR }), 0, 'a missed yesterday ends it');
  assert.equal(streak([], { at: NOON, dayStartsAt: HOUR }), 0);
});

test('a streak and its bars step back by the calendar, so a clock change does not break them', () => {
  /* Days were counted back in steps of twenty-four hours, which across the
     autumn change lands an hour off the day's start and matches nothing: a
     streak of a month ended on the Sunday the clocks went back. Under a
     zone that keeps summer time these dates straddle the change; under UTC
     they are three plain days, and the test still has to hold. */
  const nine = (d: number): Seconds => secOf(trustMs(new Date(2026, 9, d, 9).getTime()));
  const reviews = [review({ ts: nine(24) }), review({ ts: nine(25) }), review({ ts: nine(26) })];
  const monday = new Date(2026, 9, 26, 12);
  assert.equal(streak(reviews, { at: monday, dayStartsAt: HOUR }), 3);
  const bars = dailyCounts(reviews, { days: 4, at: monday, dayStartsAt: HOUR });
  assert.deepEqual(bars.map((b) => b.reviews), [0, 1, 1, 1]);
  assert.deepEqual(bars.map((b) => new Date(b.date).getHours()), [HOUR, HOUR, HOUR, HOUR],
    'every bar begins at the hour, whatever the offset did');
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
    at: NOON, dayStartsAt: HOUR,
    reviews: [
      review({ id: cardIdOf('bug|noun|fr_en'), rating: Rating.Again }),
      review({ id: cardIdOf('bug|noun|fr_en'), rating: Rating.Good, state: State.Relearning }),
      review({ id: cardIdOf('eau|noun|fr_en'), key: 'eau|noun' }),
      review({ id: cardIdOf('natel|noun|fr_en'), key: 'natel|noun', state: State.New }),
    ],
  });
  assert.equal(day.dueAnswered.size, 2, 'a new word is not a debt');
});

test('a mispronunciation is counted, not graded', () => {
  const day = summariseDay({
    at: NOON, dayStartsAt: HOUR,
    reviews: [review({ mispronounced: true }), review(), review({ mispronounced: true })],
  });
  assert.equal(day.mispronounced, 2);
  assert.equal(day.accuracy, 1, 'saying it wrong did not touch the rating');
});

const settings = madeSettings({ maxNewPerDay: 20, costPerNewWord: 2.5 });

/** `n` cards owed now, and `n` cards answered today, no card in both. */
const owedCards = (n: number): { id: CardId }[] =>
  Array.from({ length: n }, (_, i) => ({ id: cardIdOf(`owed${i}|noun|fr_en`) }));
const answered = (n: number): ReadonlySet<CardId> =>
  new Set(Array.from({ length: n }, (_, i) => cardIdOf(`done${i}|noun|fr_en`)));

test('the day is done when the debt is cleared and the allowance is taken', () => {
  const c = dayContract({ plan: 120, owed: owedCards(0), answeredToday: answered(37), metToday: 12,
    retention7d: 0.93, settings });
  assert.deepEqual(c!.debt, { done: 37, target: 37, remaining: 0 });
  /* 37 due at the start of the day leaves room for (120 - 37) / 2.5 = 33,
     clamped to the ceiling of 20; 12 of those were taken. */
  assert.deepEqual(c!.gain, { done: 12, target: 20, remaining: 8 });
  assert.equal(c!.complete, false, 'eight new words still owed');
  assert.equal(dayContract({ plan: 120, owed: owedCards(0), answeredToday: answered(37), metToday: 20,
    retention7d: 0.93, settings })!.complete, true);
});

test('the plan does not shrink as you clear it', () => {
  const morning = dayContract({ plan: 120, owed: owedCards(40), answeredToday: answered(0), metToday: 0,
    retention7d: null, settings });
  const evening = dayContract({ plan: 120, owed: owedCards(10), answeredToday: answered(30), metToday: 0,
    retention7d: null, settings });
  assert.equal(morning!.debt.target, 40);
  assert.equal(evening!.debt.target, 40, 'the same 40 you woke up to');
  assert.equal(evening!.debt.remaining, 10);
  assert.equal(morning!.gain.target, evening!.gain.target);
});

test('a heavy day is capped at what the day’s minutes hold', () => {
  const c = dayContract({ plan: 120, owed: owedCards(300), answeredToday: answered(0), metToday: 0,
    retention7d: null, settings });
  assert.equal(c!.debt.target, 120);
  assert.equal(c!.gain.target, 0, 'no room for new words on a day like that');
});

test('poor recall this week takes the new words off the plan, and the plan says so', () => {
  const c = dayContract({ plan: 120, owed: owedCards(20), answeredToday: answered(0), metToday: 0,
    retention7d: 0.8, settings });
  assert.equal(c!.gain.target, 0);
  assert.equal(c!.complete, false, 'the debt is still there');
  assert.equal(dayContract({ plan: 120, owed: owedCards(0), answeredToday: answered(20), metToday: 0,
    retention7d: 0.8, settings })!.complete, true, 'and once it is paid, that is the day');
});

test('the home screen’s "due" and the progress page’s "left" are one number', () => {
  /* Home said "1 due" and the finish line "1 of 2 due cards" with one card
     in the app: it had been graded Again, so it was answered today and owed
     again, and adding the two counts made it two cards (#48). Both screens
     read `owedNow`; what this pins is that the contract's remainder is that
     number, whatever else the day held. */
  const now = NOON.getTime();
  const cards = [
    card('morning|noun', 'written', 'recognise', { state: State.Review, due: new Date(now - 3600_000) }),
    card('cleared|noun', 'written', 'recognise', { state: State.Review, due: new Date(now + 3 * DAY) }),
    card('again|noun', 'written', 'recognise', { state: State.Relearning, due: new Date(now + 60_000) }),
    card('met|noun', 'written', 'recognise', { state: State.Learning, due: new Date(now + 600_000) }),
    card('mine|noun', 'written', 'recognise', { lesson: true, due: new Date(now - 1000) }),
    card('far|noun', 'written', 'recognise', { state: State.Learning, due: new Date(now + 45 * 60_000) }),
  ];
  const reviews = [
    review({ key: 'cleared|noun' }),
    review({ key: 'again|noun', rating: Rating.Again }),
    review({ key: 'met|noun', state: State.New }),
  ];
  const owed = owedNow(cards, NOON);
  assert.deepEqual(owed.map((c) => c.key), ['morning|noun', 'again|noun', 'met|noun']);
  const day = summariseDay({ reviews, at: NOON, dayStartsAt: HOUR });
  const c = dayContract({ owed, answeredToday: day.dueAnswered, metToday: day.met.length,
    retention7d: null, settings, plan: 120 })!;
  assert.equal(c.debt.remaining, owed.length, 'what is left here is what home says is due');
  assert.deepEqual(c.debt, { done: 1, target: 4, remaining: 3 },
    'the card graded Again is one card, and not done while it is owed');
  assert.equal(c.complete, false);
});

test('no settings, no contract', () => {
  assert.equal(dayContract({ plan: 120, owed: owedCards(5), answeredToday: answered(0), metToday: 0,
    retention7d: null, settings: null }), null);
});

test('minutes are read the way a person would say them', () => {
  assert.equal(humanMinutes(0), '0 min');
  assert.equal(humanMinutes(0.4), '<1 min');
  assert.equal(humanMinutes(12.6), '13 min');
  assert.equal(humanMinutes(60), '1 h');
  assert.equal(humanMinutes(95), '1 h 35 min');
});
