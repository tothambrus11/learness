import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  after, agoMs, atMs, before, DAY_MS, looksLikeMillis, msOf, nowMs, nowSec, secOf, trustMs,
  trustSec, WEEK_MS, whenMs,
} from '../src/lib/units.js';

test('the two units convert only through the two functions that name them', () => {
  const at = trustMs(1_700_000_000_123);
  assert.equal(secOf(at), 1_700_000_000, 'down to the whole second, never up');
  assert.equal(msOf(secOf(at)), 1_700_000_000_000);
  assert.equal(secOf(trustMs(-1500)), -2, 'and down on the other side of the epoch too');
});

test('now is the same moment in either unit', () => {
  const ms = nowMs();
  const s = nowSec();
  assert.ok(Math.abs(secOf(ms) - s) <= 1);
});

test('a cutoff is built rather than subtracted, so it keeps its unit', () => {
  const week = agoMs(WEEK_MS);
  assert.ok(week < nowMs());
  assert.ok(nowMs() - week >= WEEK_MS - 50);
  assert.equal(after(trustMs(1000), DAY_MS), 1000 + DAY_MS);
  assert.equal(before(trustMs(DAY_MS), DAY_MS), 0);
});

test('a stored date is read whatever shape it comes back in', () => {
  const date = new Date('2026-03-01T08:00:00Z');
  assert.equal(whenMs(date), date.getTime(), 'what IndexedDB gives back');
  assert.equal(whenMs(date.toISOString()), date.getTime(), 'what a sync gives back');
  assert.equal(whenMs(date.getTime()), date.getTime());
  assert.equal(atMs(date), date.getTime());
});

test('an unreadable date is the epoch, not NaN', () => {
  /* NaN would drop the card out of every comparison it takes part in — never
     due, never overdue, never merged — which is worse than being answered. */
  assert.equal(whenMs('not a date'), 0);
  assert.equal(whenMs(null), 0);
  assert.equal(whenMs(undefined), 0);
});

test('the two units can be told apart by size, for a runtime guard', () => {
  assert.equal(looksLikeMillis(Date.now()), true);
  assert.equal(looksLikeMillis(Math.floor(Date.now() / 1000)), false,
    'this is the mistake the guard exists to catch');
  assert.equal(looksLikeMillis(trustSec(4_000_000_000)), false, 'the year 2096, in seconds');
});
