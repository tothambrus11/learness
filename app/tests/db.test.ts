import { test } from 'vitest';
import assert from 'node:assert/strict';
import { agoMs, msOf, nowMs, secOf, trustMs, WEEK_MS } from '../src/lib/units.js';
import { freshApp } from './harness.js';
import { card, review, sec } from './make.js';

test('a review written now is inside the week that is asked for', async () => {
  /* The bug this exists for: the window was asked for in milliseconds against
     an index of seconds, the range matched nothing, and every screen that
     reads the week — recall, today's count, the retention throttle — read it
     as empty. Nothing threw. Nothing was logged. It just was not there. */
  const { db } = await freshApp();
  await db.logReview(review({ ts: secOf(nowMs()) }));
  const week = await db.reviewsSince(agoMs(WEEK_MS));
  assert.equal(week.length, 1, 'the review this session just wrote');
});

test('the window keeps what is inside it and drops what is not', async () => {
  const { db } = await freshApp();
  const now = nowMs();
  await db.logReview(review({ uid: 'today', ts: secOf(now) }));
  await db.logReview(review({ uid: 'six days ago', ts: secOf(trustMs(now - 6 * 86400_000)) }));
  await db.logReview(review({ uid: 'a month ago', ts: secOf(trustMs(now - 30 * 86400_000)) }));
  const week = await db.reviewsSince(agoMs(WEEK_MS));
  assert.deepEqual(week.map((r) => r.uid).sort((a, b) => a.localeCompare(b)),
    ['six days ago', 'today']);
  assert.equal((await db.allReviews()).length, 3, 'the log itself keeps everything');
});

test('a cutoff in the wrong unit is refused rather than returning nothing', async () => {
  const { db } = await freshApp();
  await db.logReview(review({ ts: secOf(nowMs()) }));
  await assert.rejects(
    () => db.reviewsSince(secOf(nowMs()) as unknown as ReturnType<typeof nowMs>),
    /milliseconds/,
    'seconds where milliseconds belong is a crash, not an empty week');
});

test('settings are the defaults with what was stored laid over them', async () => {
  const { db } = await freshApp();
  const before = await db.getSettings();
  assert.equal(before.maxNewPerDay, db.DEFAULT_SETTINGS.maxNewPerDay);
  await db.setSetting('maxNewPerDay', 5);
  const after = await db.getSettings();
  assert.equal(after.maxNewPerDay, 5);
  assert.equal(after.sessionLimit, db.DEFAULT_SETTINGS.sessionLimit, 'the rest is untouched');
});

test('a card is stored under its id and found by its word', async () => {
  const { db } = await freshApp();
  const written = card('bug|noun', 'written', 'recognise', { reps: 2 });
  const heard = card('bug|noun', 'heard', 'hear');
  await db.putCard(written);
  await db.putCard(heard);
  await db.putCard(card('table|noun', 'written', 'recognise'));

  assert.equal((await db.getCard(written.id))?.reps, 2);
  const rungs = (await db.cardsFor(written.key)).map((c) => c.rung ?? '');
  assert.deepEqual(rungs.sort((a, b) => a.localeCompare(b)),
    ['hear', 'recognise'], 'every rung of the word, on either channel');
  assert.equal((await db.allCards()).length, 3);
});

test('the sitting in progress is kept aside from what is learned', async () => {
  const { db } = await freshApp();
  assert.equal(await db.getMeta('sitting'), null);
  await db.setMeta('sitting', { ids: ['a'], i: 0 });
  assert.deepEqual(await db.getMeta('sitting'), { ids: ['a'], i: 0 });
  await db.clearMeta('sitting');
  assert.equal(await db.getMeta('sitting'), null);
});

test('an export carries the log in the unit the pipeline reads', async () => {
  const { db } = await freshApp();
  const at = sec(1_700_000_000);
  await db.putCard(card('bug|noun', 'written', 'recognise', { due: new Date(msOf(at)) }));
  await db.logReview(review({ ts: at }));
  const out = await db.exportProgress();
  assert.equal(out.reviews.length, 1);
  assert.deepEqual(out.states.map((s) => (s as { due: number }).due), [at],
    'seconds, as the review log stores them');
});

test('a week of minutes handed over is copied, not kept', async () => {
  /* The settings screen hands over a `$state` list, which the structured
     clone refuses; and a list kept by reference would change under the
     store. */
  const { db } = await freshApp();
  const week = [5, 10, 15, 20, 25, 30, 35];
  await db.setSetting('minutesByWeekday', week);
  week[0] = 99;
  assert.deepEqual((await db.getSettings()).minutesByWeekday, [5, 10, 15, 20, 25, 30, 35]);
});

test('settings carry the week’s minutes and the exploration gap by default', async () => {
  const { db } = await freshApp();
  const s = await db.getSettings();
  assert.deepEqual(s.minutesByWeekday, [20, 20, 20, 20, 20, 20, 20]);
  assert.equal(s.exploreEvery, 5);
  assert.equal(s.targetReviews, undefined, 'the day is minutes now, not a count of reviews');
});
