import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/lib/db.js';
import { card, k, review } from './make.js';
import {
  allowanceReason, emptyCard, grade, isDue, isMature,
  newAllowance, pickRefresher, Rating, retention, retrievability, scheduler, State,
} from '../src/lib/scheduler.js';

const S = { ...DEFAULT_SETTINGS };

test('a new card starts due and not mature, on its rung', () => {
  const c = emptyCard(k('bug|noun'), 'written', 'recognise');
  assert.equal(c.id, 'bug|noun|written|recognise');
  assert.equal(c.channel, 'written');
  assert.equal(c.rung, 'recognise');
  assert.equal(c.retired, false);
  assert.equal(c.state, State.New);
  assert.ok(isDue(c));
  assert.ok(!isMature(c));
});

test('answering Good repeatedly builds stability until the word is known', () => {
  const f = scheduler(S);
  let c = emptyCard(k('bug|noun'), 'written', 'recognise');
  let now = new Date('2026-01-01T08:00:00Z');
  for (let i = 0; i < 8; i++) {
    c = grade(f, c, Rating.Good, now, S);
    now = new Date(c.due);
  }
  assert.ok(c.stability >= 21, `expected a mature card, stability was ${c.stability}`);
  assert.ok(isMature(c));
});

test('Again records a lapse and brings the card back soon', () => {
  const f = scheduler(S);
  let c = emptyCard(k('bug|noun'), 'written', 'recognise');
  const now = new Date('2026-01-01T08:00:00Z');
  c = grade(f, c, Rating.Good, now, S);
  const before = c.due;
  c = grade(f, c, Rating.Again, new Date(before), S);
  assert.equal(c.lapses >= 1 || c.state === State.Learning, true);
  assert.ok(new Date(c.due).getTime() - new Date(before).getTime() < 86400000);
});

test('a card is flagged as a leech once it has lapsed enough', () => {
  const f = scheduler(S);
  let c = emptyCard(k('x|verb'), 'written', 'recognise');
  let now = new Date('2026-01-01T08:00:00Z');
  /* Lapses only count once a card has graduated into review, so get it there
     before failing it repeatedly. */
  while (c.state !== State.Review) {
    c = grade(f, c, Rating.Good, now, S);
    now = new Date(c.due);
  }
  for (let i = 0; i < 30 && !c.leech; i++) {
    c = grade(f, c, Rating.Again, now, S);
    now = new Date(c.due);
    while (c.state !== State.Review) {
      c = grade(f, c, Rating.Good, now, S);
      now = new Date(c.due);
    }
  }
  assert.ok(c.leech, `repeated failure should flag the card (lapses=${c.lapses})`);
  assert.ok(c.lapses >= S.leechThreshold);
});

test('new words are throttled by what is already due', () => {
  const empty = newAllowance({ dueCount: 0, retention7d: 0.95, settings: S });
  const busy = newAllowance({ dueCount: 110, retention7d: 0.95, settings: S });
  const full = newAllowance({ dueCount: 300, retention7d: 0.95, settings: S });
  assert.equal(empty, S.maxNewPerDay, 'an empty day reaches the ceiling');
  assert.ok(busy > 0 && busy < S.maxNewPerDay, `expected a partial allowance, got ${busy}`);
  assert.equal(full, 0, 'a backlog stops new words entirely');
});

test("today's ceiling is spent by the words already met today", () => {
  const fresh = newAllowance({ dueCount: 0, retention7d: 0.95, settings: S });
  const halfway = newAllowance({ dueCount: 0, retention7d: 0.95, settings: S,
    introducedToday: 8 });
  const spent = newAllowance({ dueCount: 0, retention7d: 0.95, settings: S,
    introducedToday: S.maxNewPerDay });
  assert.equal(fresh, S.maxNewPerDay);
  assert.equal(halfway, S.maxNewPerDay - 8, 'a second sitting gets what is left, not a fresh lot');
  assert.equal(spent, 0, 'and nothing once the day is done');
  assert.equal(newAllowance({ dueCount: 0, retention7d: 0.95, settings: S,
    introducedToday: S.maxNewPerDay + 5 }), 0, 'never below zero');
});

test('forgetting a lot stops new words on its own', () => {
  const ok = newAllowance({ dueCount: 0, retention7d: 0.95, settings: S });
  const usual = newAllowance({ dueCount: 0, retention7d: 0.87, settings: S });
  const shaky = newAllowance({ dueCount: 0, retention7d: 0.85, settings: S });
  const bad = newAllowance({ dueCount: 0, retention7d: 0.7, settings: S });
  assert.equal(ok, S.maxNewPerDay);
  assert.equal(usual, S.maxNewPerDay, 'three points under the dial is an ordinary week');
  assert.equal(shaky, Math.floor(S.maxNewPerDay / 2), 'a shaky week halves intake');
  assert.equal(bad, 0, 'a bad week pauses intake');
});

test('the throttle is measured against the recall you asked for, not against 90%', () => {
  /* The thresholds were 85% and 90% in absolute terms. A learner who turned
     the dial down to 85% — where the FSRS simulations put the optimum — was
     then asking the scheduler for exactly the recall that halves intake, and
     any bad week stopped it. Found while reading one learner's log: 98%
     recall, the throttle nowhere near; but the first honest week at 85%
     would have read as failure. */
  const at = (desiredRetention: number, retention7d: number): number =>
    newAllowance({ dueCount: 0, retention7d, settings: { ...S, desiredRetention } });
  assert.equal(at(0.85, 0.85), S.maxNewPerDay, 'hitting the dial you set is not a shortfall');
  assert.equal(at(0.85, 0.83), S.maxNewPerDay, 'two points under is within a week\'s noise');
  assert.equal(at(0.8, 0.74), Math.floor(S.maxNewPerDay / 2), 'six under halves, at any dial');
  assert.equal(at(0.95, 0.87), Math.floor(S.maxNewPerDay / 2), 'eight under halves, not stops');
  assert.equal(at(0.95, 0.84), 0, 'eleven under stops');
  assert.equal(at(0.9, 0.85), Math.floor(S.maxNewPerDay / 2),
    'exactly five under halves — whole points, not 0.8500000000000001');
  assert.match(
    allowanceReason({ dueCount: 0, retention7d: 0.7, settings: S, allowance: 0 }),
    /against the 90% you asked for/,
    'the reason names the dial, so the number on screen is the one to turn');
});

test('the allowance explains itself', () => {
  const reason = allowanceReason({ dueCount: 0, retention7d: 0.7, settings: S, allowance: 0 });
  assert.match(reason, /recall this week/);
  assert.match(
    allowanceReason({ dueCount: 0, retention7d: 0.95, settings: S, allowance: 0,
      introducedToday: S.maxNewPerDay }),
    /new words are done/,
    'a spent day says so, rather than looking like a stuck app');
  assert.match(
    allowanceReason({ dueCount: 0, retention7d: 0.95, settings: S, allowance: 12,
      introducedToday: 8 }),
    /8 met today/);
});

test('retention ignores first exposures and needs evidence', () => {
  const firstTimes = Array.from({ length: 40 },
    () => review({ rating: Rating.Again, state: State.New }));
  assert.equal(retention(firstTimes), null, 'new cards are not a memory test');
  const real = [
    ...Array.from({ length: 18 }, () => review({ rating: Rating.Good, state: State.Review })),
    ...Array.from({ length: 2 }, () => review({ rating: Rating.Again, state: State.Review })),
  ];
  assert.equal(retention(real), 0.9);
});

test('the refresher picks mature words that are not due yet', () => {
  const now = new Date('2026-06-01T08:00:00Z');
  const older = new Date('2026-04-01T08:00:00Z');
  const cards = [
    card('a|noun', 'written', 'recognise',
      { state: State.Review, stability: 60, due: new Date('2026-08-01'), last_review: older }),
    card('b|noun', 'written', 'recognise',
      { state: State.Review, stability: 60, due: new Date('2026-08-01'), last_review: now }),
    card('c|noun', 'written', 'recognise',
      { state: State.Review, stability: 60, due: new Date('2026-05-01'), last_review: older }),
    card('d|noun', 'written', 'recognise',
      { state: State.New, stability: 0, due: now, last_review: null }),
  ];
  const picked = pickRefresher(cards, { now, count: 2, weightOf: () => 1 });
  const keys = new Set(picked.map((c) => c.key));
  assert.ok(!keys.has(k('c|noun')), 'a due card belongs in the review queue, not here');
  assert.ok(!keys.has(k('d|noun')), 'a new card is not a refresher');
  assert.ok(keys.has(k('a|noun')), 'the longest-unseen word comes first');
});

test('a card never seen counts as forgotten, a card just seen as remembered', () => {
  const f = scheduler(S);
  const now = new Date('2026-06-01T08:00:00Z');
  const fresh = card('a|noun');
  const seen = card('b|noun', 'written', 'recognise', {
    state: State.Review, stability: 40, reps: 5, last_review: now,
    due: new Date('2026-07-11T08:00:00Z'),
  });
  assert.equal(retrievability(f, fresh, now), 0, 'nothing is known, so nothing is remembered');
  const today = retrievability(f, seen, now);
  assert.ok(today > 0.95, `just answered, all but certain: ${today}`);
  const later = retrievability(f, seen, new Date('2027-06-01T08:00:00Z'));
  assert.ok(later < today && later > 0, `a year on, less so: ${later}`);
});

test('the refresher is the same choice every time it is asked', () => {
  /* A dash of chance in the score was one of the two reasons a reload dealt
     a different card; the other was the shuffle. Both are gone. */
  const now = new Date('2026-06-01T08:00:00Z');
  const cards = Array.from({ length: 8 }, (_, i) =>
    card(`w${i}|noun`, 'written', 'recognise', {
      state: State.Review, stability: 60, due: new Date('2026-08-01'),
      last_review: new Date(`2026-04-0${(i % 4) + 1}`),
    }));
  const once = pickRefresher(cards, { now, count: 3, weightOf: () => 1 }).map((c) => c.id);
  const again = pickRefresher(cards, { now, count: 3, weightOf: () => 1 }).map((c) => c.id);
  assert.deepEqual(once, again);
  assert.equal(once.length, 3);
});
