import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/lib/db.js';
import {
  allowanceReason, assembleSession, emptyCard, grade, isDue, isMature,
  isUnlocked, newAllowance, pickRefresher, Rating, retention, scheduler, State,
} from '../src/lib/scheduler.js';

const S = { ...DEFAULT_SETTINGS };

test('a new card starts due and not mature', () => {
  const c = emptyCard('bug|noun', 'fr_en');
  assert.equal(c.id, 'bug|noun|fr_en');
  assert.equal(c.state, State.New);
  assert.ok(isDue(c));
  assert.ok(!isMature(c));
});

test('answering Good repeatedly builds stability until the word is known', () => {
  const f = scheduler(S);
  let c = emptyCard('bug|noun', 'fr_en');
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
  let c = emptyCard('bug|noun', 'fr_en');
  const now = new Date('2026-01-01T08:00:00Z');
  c = grade(f, c, Rating.Good, now, S);
  const before = c.due;
  c = grade(f, c, Rating.Again, new Date(before), S);
  assert.equal(c.lapses >= 1 || c.state === State.Learning, true);
  assert.ok(new Date(c.due) - new Date(before) < 86400000);
});

test('a card is flagged as a leech once it has lapsed enough', () => {
  const f = scheduler(S);
  let c = emptyCard('x|verb', 'fr_en');
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

test('directions unlock only when the prerequisite is known', () => {
  const young = emptyCard('bug|noun', 'fr_en');
  const known = { ...young, state: State.Review, stability: 40 };
  assert.ok(isUnlocked('fr_en', {}), 'reading is always open');
  assert.ok(isUnlocked('speak', {}), 'speaking needs no prerequisite');
  assert.ok(!isUnlocked('en_fr', { fr_en: young }));
  assert.ok(isUnlocked('en_fr', { fr_en: known }));
  assert.ok(!isUnlocked('audio_fr', { fr_en: known }), 'writing from audio waits for recall');
});

test('new words are throttled by what is already due', () => {
  const empty = newAllowance({ dueCount: 0, retention7d: 0.95, settings: S });
  const busy = newAllowance({ dueCount: 110, retention7d: 0.95, settings: S });
  const full = newAllowance({ dueCount: 300, retention7d: 0.95, settings: S });
  assert.equal(empty, S.maxNewPerDay, 'an empty day reaches the ceiling');
  assert.ok(busy > 0 && busy < S.maxNewPerDay, `expected a partial allowance, got ${busy}`);
  assert.equal(full, 0, 'a backlog stops new words entirely');
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
});

test('retention ignores first exposures and needs evidence', () => {
  const firstTimes = Array.from({ length: 40 }, () => ({ rating: 1, state: State.New }));
  assert.equal(retention(firstTimes), null, 'new cards are not a memory test');
  const real = [
    ...Array.from({ length: 18 }, () => ({ rating: 3, state: State.Review })),
    ...Array.from({ length: 2 }, () => ({ rating: 1, state: State.Review })),
  ];
  assert.equal(retention(real), 0.9);
});

test('the refresher picks mature words that are not due yet', () => {
  const now = new Date('2026-06-01T08:00:00Z');
  const older = new Date('2026-04-01T08:00:00Z');
  const cards = [
    { key: 'a|noun', state: State.Review, stability: 60, due: new Date('2026-08-01'), last_review: older },
    { key: 'b|noun', state: State.Review, stability: 60, due: new Date('2026-08-01'), last_review: now },
    { key: 'c|noun', state: State.Review, stability: 60, due: new Date('2026-05-01'), last_review: older },
    { key: 'd|noun', state: State.New, stability: 0, due: now, last_review: null },
  ];
  const picked = pickRefresher(cards, { now, count: 2, weightOf: () => 1 });
  const keys = picked.map((c) => c.key);
  assert.ok(!keys.includes('c|noun'), 'a due card belongs in the review queue, not here');
  assert.ok(!keys.includes('d|noun'), 'a new card is not a refresher');
  assert.ok(keys.includes('a|noun'), 'the longest-unseen word comes first');
});

test('a session spreads new words through the reviews', () => {
  const due = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, kind: 'review' }));
  const fresh = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, kind: 'new' }));
  const out = assembleSession({ due, newItems: fresh, refresher: [], settings: S });
  assert.equal(out.length, 24);
  const positions = out.map((x, i) => (x.kind === 'new' ? i : -1)).filter((i) => i >= 0);
  assert.equal(positions.length, 4);
  assert.ok(positions[positions.length - 1] - positions[0] > 8, 'not all clumped together');
});

test('a session is capped so it fits one sitting', () => {
  const due = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}` }));
  const out = assembleSession({ due, newItems: [], refresher: [], settings: S });
  assert.equal(out.length, S.sessionLimit);
});
