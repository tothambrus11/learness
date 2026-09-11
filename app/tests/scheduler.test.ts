/** Scheduling: what an answer does to a card, and how much a day may hold. */
import type { Grade } from 'ts-fsrs';
import { expect, test } from 'vitest';

import { DEFAULT_SETTINGS } from '../src/lib/db';
import {
  allowanceReason,
  assembleSession,
  emptyCard,
  grade,
  isDue,
  isMature,
  newAllowance,
  pickRefresher,
  Rating,
  retention,
  scheduler,
  State,
} from '../src/lib/scheduler';
import type { RefresherCard } from '../src/lib/scheduler';
import type { Review, Settings } from '../src/lib/types';

/** The dials every case below is run at: the shipped defaults. */
const S: Settings = { ...DEFAULT_SETTINGS };

test('a new card starts due and not mature, on its rung', () => {
  const c = emptyCard('bug|noun', 'written', 'recognise');
  expect(c.id).toBe('bug|noun|written|recognise');
  expect(c.channel).toBe('written');
  expect(c.rung).toBe('recognise');
  expect(c.retired).toBe(false);
  expect(c.state).toBe(State.New);
  expect(isDue(c)).toBeTruthy();
  expect(!isMature(c)).toBeTruthy();
});

test('answering Good repeatedly builds stability until the word is known', () => {
  const f = scheduler(S);
  let c = emptyCard('bug|noun', 'written', 'recognise');
  let now = new Date('2026-01-01T08:00:00Z');
  for (let i = 0; i < 8; i++) {
    c = grade(f, c, Rating.Good, now, S);
    now = new Date(c.due);
  }
  expect(
    c.stability >= 21,
    `expected a mature card, stability was ${c.stability}`,
  ).toBeTruthy();
  expect(isMature(c)).toBeTruthy();
});

test('Again records a lapse and brings the card back sooner than a Good would', () => {
  const f = scheduler(S);
  let c = emptyCard('bug|noun', 'written', 'recognise');
  const now = new Date('2026-01-01T08:00:00Z');
  c = grade(f, c, Rating.Good, now, S);
  const before = new Date(c.due);
  const failed = grade(f, c, Rating.Again, before, S);
  const passed = grade(f, c, Rating.Good, before, S);
  expect(failed.lapses >= 1).toBeTruthy();
  expect(new Date(failed.due) < new Date(passed.due)).toBeTruthy();
  /* Within the sitting the card is dealt again at once; that is the queue's
     doing, not the schedule's, so the schedule need not be the same day. */
  expect(new Date(failed.due).getTime() - before.getTime() <= 3 * 86400000).toBeTruthy();
});

test('a card is flagged as a leech once it has lapsed enough', () => {
  const f = scheduler(S);
  let c = emptyCard('x|verb', 'written', 'recognise');
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
  expect(c.leech, `repeated failure should flag the card (lapses=${c.lapses})`).toBeTruthy();
  expect(c.lapses >= S.leechThreshold).toBeTruthy();
});

test('a Good answer is not due again the same day', () => {
  /* The library's default steps brought a new card rated Good back ten
     minutes later, which read on the home screen as progress not saved. The
     sitting deals an Again again itself; the schedule is for days. */
  const f = scheduler(S);
  const now = new Date('2026-01-01T08:00:00Z');
  for (const rating of [Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    const c = grade(f, emptyCard('bug|noun', 'written', 'recognise'), rating, now, S);
    expect(c.state, 'no learning state to sit in').toBe(State.Review);
    const waited = new Date(c.due).getTime() - now.getTime();
    expect(
      waited >= 20 * 3600 * 1000,
      `rated ${rating}, due in ${waited / 3600000} h`,
    ).toBeTruthy();
  }
  /* A card from before, still in the old learning state, moves on too. */
  const stuck = {
    ...emptyCard('x|noun', 'written', 'recognise'),
    state: State.Learning,
    learning_steps: 1,
    stability: 2.3,
    difficulty: 5,
  };
  const on = grade(f, stuck, Rating.Good, now, S);
  expect(on.state).toBe(State.Review);
  expect(new Date(on.due).getTime() - now.getTime() >= 20 * 3600 * 1000).toBeTruthy();
});

test('new words already met today count against the ceiling', () => {
  const some = newAllowance({
    dueCount: 0,
    retention7d: 0.95,
    settings: S,
    introducedToday: 15,
  });
  const all = newAllowance({
    dueCount: 0,
    retention7d: 0.95,
    settings: S,
    introducedToday: S.maxNewPerDay,
  });
  expect(some).toBe(S.maxNewPerDay - 15);
  expect(all, 'a second sitting does not deal a second day of new words').toBe(0);
});

test('new words are throttled by what is already due', () => {
  const empty = newAllowance({ dueCount: 0, retention7d: 0.95, settings: S });
  const busy = newAllowance({ dueCount: 110, retention7d: 0.95, settings: S });
  const full = newAllowance({ dueCount: 300, retention7d: 0.95, settings: S });
  expect(empty, 'an empty day reaches the ceiling').toBe(S.maxNewPerDay);
  expect(
    busy > 0 && busy < S.maxNewPerDay,
    `expected a partial allowance, got ${busy}`,
  ).toBeTruthy();
  expect(full, 'a backlog stops new words entirely').toBe(0);
});

test('forgetting a lot stops new words on its own', () => {
  const ok = newAllowance({ dueCount: 0, retention7d: 0.95, settings: S });
  const shaky = newAllowance({ dueCount: 0, retention7d: 0.87, settings: S });
  const bad = newAllowance({ dueCount: 0, retention7d: 0.7, settings: S });
  expect(ok).toBe(S.maxNewPerDay);
  expect(shaky, 'a shaky week halves intake').toBe(Math.floor(S.maxNewPerDay / 2));
  expect(bad, 'a bad week pauses intake').toBe(0);
});

test('the allowance explains itself', () => {
  const reason = allowanceReason({ dueCount: 0, retention7d: 0.7, settings: S, allowance: 0 });
  expect(reason).toMatch(/recall this week/);
});

test('retention ignores first exposures and needs evidence', () => {
  /** Forty answers that were all first meetings, which is no evidence at all. */
  const firstTimes: Pick<Review, 'rating' | 'state'>[] = Array.from({ length: 40 }, () => ({
    rating: Rating.Again,
    state: State.New,
  }));
  expect(retention(firstTimes), 'new cards are not a memory test').toBe(null);
  /** Twenty real memory tests, eighteen of them right. */
  const real: Pick<Review, 'rating' | 'state'>[] = [
    ...Array.from({ length: 18 }, (): Pick<Review, 'rating' | 'state'> => ({
      rating: Rating.Good,
      state: State.Review,
    })),
    ...Array.from({ length: 2 }, (): Pick<Review, 'rating' | 'state'> => ({
      rating: Rating.Again,
      state: State.Review,
    })),
  ];
  expect(retention(real)).toBe(0.9);
});

test('the refresher picks mature words that are not due yet', () => {
  const now = new Date('2026-06-01T08:00:00Z');
  const older = new Date('2026-04-01T08:00:00Z');
  /** Four words: two known and not due, one known and due, one brand new. */
  const cards: RefresherCard[] = [
    {
      key: 'a|noun',
      state: State.Review,
      stability: 60,
      due: new Date('2026-08-01'),
      last_review: older,
    },
    {
      key: 'b|noun',
      state: State.Review,
      stability: 60,
      due: new Date('2026-08-01'),
      last_review: now,
    },
    {
      key: 'c|noun',
      state: State.Review,
      stability: 60,
      due: new Date('2026-05-01'),
      last_review: older,
    },
    { key: 'd|noun', state: State.New, stability: 0, due: now },
  ];
  const picked = pickRefresher(cards, { now, count: 2, weightOf: () => 1 });
  const keys = picked.map((c) => c.key);
  expect(
    !keys.includes('c|noun'),
    'a due card belongs in the review queue, not here',
  ).toBeTruthy();
  expect(!keys.includes('d|noun'), 'a new card is not a refresher').toBeTruthy();
  expect(keys.includes('a|noun'), 'the longest-unseen word comes first').toBeTruthy();
});

test('a session spreads new words through the reviews', () => {
  const due = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, kind: 'review' }));
  const fresh = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, kind: 'new' }));
  const out = assembleSession({ due, newItems: fresh, refresher: [], settings: S });
  expect(out.length).toBe(24);
  const positions = out.map((x, i) => (x.kind === 'new' ? i : -1)).filter((i) => i >= 0);
  expect(positions.length).toBe(4);
  expect(
    positions[positions.length - 1] - positions[0] > 8,
    'not all clumped together',
  ).toBeTruthy();
});

test('a session is capped so it fits one sitting', () => {
  const due = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}` }));
  const out = assembleSession({ due, newItems: [], refresher: [], settings: S });
  expect(out.length).toBe(S.sessionLimit);
});

test('a refresher only takes room the due pile leaves', () => {
  const due = Array.from({ length: S.sessionLimit }, (_, i) => ({ id: `r${i}`, kind: 'due' }));
  const warm = Array.from({ length: 5 }, (_, i) => ({ id: `w${i}`, kind: 'warm' }));
  const full = assembleSession({ due, newItems: [], refresher: warm, settings: S });
  expect(full.length).toBe(S.sessionLimit);
  expect(
    full.every((x) => x.kind === 'due'),
    'on a backlog, no well-known word displaces a due one',
  ).toBeTruthy();

  const light = assembleSession({
    due: due.slice(0, 10),
    newItems: [],
    refresher: warm,
    settings: S,
  });
  expect(
    light.filter((x) => x.kind === 'warm').length,
    'on a quiet day they are all dealt',
  ).toBe(5);
  expect(light.length).toBe(15);
});

test('words from a lesson come before everything else', () => {
  const first = [{ id: 'l1' }, { id: 'l2' }];
  const due = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
  const fresh = [{ id: 'n0' }, { id: 'n1' }];
  const out = assembleSession({ first, due, newItems: fresh, refresher: [], settings: S });
  expect(out.slice(0, 2).map((x) => x.id)).toEqual(['l1', 'l2']);
  expect(out.length).toBe(14);
  /* they count against the sitting, so a big lesson still fits in one */
  const many = Array.from({ length: 70 }, (_, i) => ({ id: `l${i}` }));
  expect(
    assembleSession({ first: many, due, newItems: fresh, refresher: [], settings: S }).length,
  ).toBe(S.sessionLimit);
});
