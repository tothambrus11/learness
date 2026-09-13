import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/lib/db.js';
import type { LadderCard } from '../src/lib/model.js';
import { card, k, review } from './make.js';
import {
  allowanceReason, assembleSession, emptyCard, grade, isDue, isMature,
  newAllowance, pickRefresher, Rating, retention, scheduler, State,
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
  const shaky = newAllowance({ dueCount: 0, retention7d: 0.87, settings: S });
  const bad = newAllowance({ dueCount: 0, retention7d: 0.7, settings: S });
  assert.equal(ok, S.maxNewPerDay);
  assert.equal(shaky, Math.floor(S.maxNewPerDay / 2), 'a shaky week halves intake');
  assert.equal(bad, 0, 'a bad week pauses intake');
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
  const keys = picked.map((c) => c.key);
  assert.ok(!keys.includes(k('c|noun')), 'a due card belongs in the review queue, not here');
  assert.ok(!keys.includes(k('d|noun')), 'a new card is not a refresher');
  assert.ok(keys.includes(k('a|noun')), 'the longest-unseen word comes first');
});

test('a session spreads new words through the reviews', () => {
  const due = Array.from({ length: 20 }, (_, i) => card(`r${i}|noun`));
  const fresh = Array.from({ length: 4 }, (_, i) => card(`n${i}|noun`));
  const isNew = new Set(fresh.map((c) => c.id));
  const out = assembleSession({ due, newItems: fresh, refresher: [], settings: S });
  assert.equal(out.length, 24);
  const positions = out.map((x, i) => (isNew.has(x.id) ? i : -1)).filter((i) => i >= 0);
  assert.equal(positions.length, 4);
  assert.ok((positions.at(-1) ?? 0) - (positions[0] ?? 0) > 8, 'not all clumped together');
});

test('a session is capped so it fits one sitting', () => {
  const due = Array.from({ length: 500 }, (_, i) => card(`r${i}|noun`));
  const out = assembleSession({ due, newItems: [], refresher: [], settings: S });
  assert.equal(out.length, S.sessionLimit);
});

test('words from a lesson come before everything else', () => {
  const first: LadderCard[] = [card('l1|noun'), card('l2|noun')];
  const due = Array.from({ length: 10 }, (_, i) => card(`r${i}|noun`));
  const fresh = [card('n0|noun'), card('n1|noun')];
  const out = assembleSession({ first, due, newItems: fresh, refresher: [], settings: S });
  assert.deepEqual(out.slice(0, 2).map((x) => x.id),
    ['l1|noun|written|recognise', 'l2|noun|written|recognise']);
  assert.equal(out.length, 14);
  /* they count against the sitting, so a big lesson still fits in one */
  const many = Array.from({ length: 70 }, (_, i) => card(`l${i}|noun`));
  assert.equal(assembleSession({ first: many, due, newItems: fresh, refresher: [], settings: S }).length,
    S.sessionLimit);
});
