import { test } from 'vitest';
import assert from 'node:assert/strict';
import { agoMs, msOf, nowMs, secOf, trustMs, WEEK_MS } from '../src/lib/units.js';
import { freshApp } from './harness.js';
import { attempt, bit, card, review, ruleCard, sec } from './make.js';

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

test('a settings row written before the day had an hour reads as three in the morning', async () => {
  /* The row is the learner's from before the setting existed: every other
     dial set, nothing said about the hour. The default lands over it, so
     the day turns at three and not at "undefined o'clock". */
  const { db } = await freshApp();
  const d = await db.db();
  await d.put('settings', { name: 'maxNewPerDay', value: 7 });
  await d.put('settings', { name: 'minutesByWeekday', value: [10, 10, 10, 10, 10, 10, 10] });
  const s = await db.getSettings();
  assert.equal(s.dayStartsAt, 3);
  assert.equal(s.maxNewPerDay, 7, 'and what was stored still stands');
  await db.setSetting('dayStartsAt', 5);
  assert.equal((await db.getSettings()).dayStartsAt, 5, 'an hour set is the hour read');
});

test('settings carry the week’s minutes and the exploration gap by default', async () => {
  const { db } = await freshApp();
  const s = await db.getSettings();
  assert.deepEqual(s.minutesByWeekday, [20, 20, 20, 20, 20, 20, 20]);
  assert.equal(s.exploreEvery, 5);
  assert.equal(s.targetReviews, undefined, 'the day is minutes now, not a count of reviews');
  assert.deepEqual(s.formGap, { mode: 'fixed', ms: 0 }, 'a tense read aloud runs on, line to line');
});

test('a bit opened is open, a bit closed is kept as a tombstone, and the export carries both', async () => {
  const { db } = await freshApp();
  await db.putBit(bit('V.pc'));
  await db.putBit(bit('V.imparfait', { deleted: true }));
  assert.deepEqual((await db.openBits()).map((b) => b.id), ['V.pc']);
  assert.deepEqual((await db.allBits()).map((b) => b.id).sort(), ['V.imparfait', 'V.pc'],
    'closed is a record too: the sync has to carry the closing');
  assert.equal((await db.exportProgress()).bits.length, 2);
});

test('the grammar\'s log and state are stored, windowed in the log\'s unit, and exported', async () => {
  const { db } = await freshApp();
  const now = nowMs();
  await db.logAttempt(attempt({ uid: 'today', ts: secOf(now) }));
  await db.logAttempt(attempt({ uid: 'a month ago', ts: secOf(trustMs(now - 30 * 86400_000)) }));
  await db.putRuleCard(ruleCard('N.tens'));
  assert.deepEqual((await db.attemptsSince(agoMs(WEEK_MS))).map((a) => a.uid), ['today']);
  await assert.rejects(() => db.attemptsSince(secOf(now) as unknown as ReturnType<typeof nowMs>), /milliseconds/,
    'a cutoff in the wrong unit is refused rather than returning nothing');
  assert.equal((await db.getRuleCard('N.tens|produce'))?.rule, 'N.tens');
  const out = await db.exportProgress();
  assert.equal(out.attempts.length, 2);
  assert.equal(out.rulecards.length, 1);
});
