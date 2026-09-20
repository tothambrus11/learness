/** The cap on the audio made here: what goes when it fills, and when.
 *
 *  #52: a sitting a day for a year is a gigabyte of sentences on a phone. The
 *  rule is a table over sizes and times; the database half is driven against
 *  the real store, rows from before the cap included.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MB, roomForOne, toEvict, usage } from '../src/lib/clipcache.js';
import { freshApp } from './harness.js';
import { clip, ms, word } from './make.js';

const use = (id: string, bytes: number, usedAt: number | null) =>
  ({ id, bytes, usedAt: usedAt === null ? null : ms(usedAt) });

test('the cap drops what has not been heard for longest, until the rest fits', () => {
  const clips = [use('a', 40, 3000), use('b', 40, 1000), use('c', 40, 2000), use('d', 40, 4000)];
  assert.deepEqual(toEvict(clips, 100), ['b', 'c'], 'the two oldest hearings: 160 → 80');
  assert.deepEqual(toEvict(clips, 120), ['b'], 'one is enough: 160 → 120');
  assert.deepEqual(toEvict(clips, 160), [], 'exactly at the cap is under it');
  assert.deepEqual(toEvict(clips, 10), ['b', 'c', 'a', 'd'], 'a cap nothing fits empties it');
});

test('no cap drops nothing, and neither does an empty cache', () => {
  const clips = [use('a', 40, 3000), use('b', 40, 1000)];
  assert.deepEqual(toEvict(clips, 0), []);
  assert.deepEqual(toEvict(clips, -1), []);
  assert.deepEqual(toEvict(clips, Number.NaN), []);
  assert.deepEqual(toEvict([], 10), []);
});

test('a clip never heard goes before any that was, and a row from before the cap counts as never heard', () => {
  assert.deepEqual(toEvict([use('heard', 40, 1), use('never', 40, null)], 40), ['never']);
  /* A row written before `lastUsed` existed: it falls back to when it was
     made, and one with neither is the oldest thing there is. */
  const old = usage(clip({ id: 'old', createdAt: ms(500) }));
  assert.deepEqual(old, { id: 'old', bytes: 1, usedAt: ms(500) }, 'the blob knows its own size');
  assert.equal(usage(clip({ id: 'older' })).usedAt, null);
  assert.equal(usage(clip({ id: 'x', createdAt: ms(500), lastUsed: ms(900) })).usedAt, ms(900),
    'a hearing beats the making');
});

test('room for one more clip is judged by the size this device makes them, not by being under the cap', () => {
  /* The cap trims after every clip, so a capped cache is nearly always just
     under it. Fed on "under the cap", the backlog made a clip, the trim
     dropped the oldest, that word was owed again, and round it went. */
  const capped = { capClips: true, clipCacheMb: 1 };
  assert.equal(roomForOne({ clips: 0, bytes: 0 }, capped), true, 'nothing made yet');
  assert.equal(roomForOne({ clips: 3, bytes: 0.6 * MB }, capped), true, '0.6 + 0.2 fits in 1');
  assert.equal(roomForOne({ clips: 3, bytes: 0.9 * MB }, capped), false, '0.9 + 0.3 does not');
  assert.equal(roomForOne({ clips: 3, bytes: 0.75 * MB }, capped), true, 'exactly full is room');
  assert.equal(roomForOne({ clips: 300, bytes: 90 * MB }, { capClips: false, clipCacheMb: 1 }), true,
    'no cap, no question');
});

const big = (id: string, over: Parameters<typeof clip>[0] = {}) =>
  clip({ id, key: id, blob: new Blob([new Uint8Array(600 * 1024)]), ...over });

test('trimming drops the least recently heard clips from the database, and only with the cap on',
  async () => {
    const app = await freshApp();
    const { trimClips, clipCacheSize } = await import('../src/lib/clipcache.js');
    await app.db.putClip(big('a|noun|fr|supertonic', { lastUsed: ms(3000) }));
    await app.db.putClip(big('b|noun|fr|supertonic', { lastUsed: ms(1000) }));
    await app.db.putClip(big('c|noun|fr|supertonic'));       /* from before the cap */
    assert.equal((await clipCacheSize()).clips, 3);

    assert.deepEqual(await trimClips(), [], 'off by default: nothing goes');
    await app.db.setSetting('capClips', true);
    await app.db.setSetting('clipCacheMb', 1);              /* three of 600 KB: one fits */
    assert.deepEqual(await trimClips(), ['c|noun|fr|supertonic', 'b|noun|fr|supertonic']);
    const left = await app.db.allClips();
    assert.deepEqual(left.map((c) => c.id), ['a|noun|fr|supertonic'], 'the one heard latest stays');
    assert.ok((await clipCacheSize()).bytes <= MB);
  });

test('handing a clip to the player is what counts as hearing it', async () => {
  const app = await freshApp();
  const { srcFor } = await import('../src/lib/audio.js');
  const { vi } = await import('vitest');
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:1');
  const mine = word({ k: 'natel|noun', fr: 'le natel', answer: 'le natel', pos: 'noun',
    gender: 'm', audio: null, native: null, user: true, en: ['mobile phone'] });
  await app.db.putClip(clip({ id: 'natel|noun|fr|supertonic', key: 'natel|noun', text: 'le natel',
    createdAt: ms(1) }));
  const before = Date.now();
  await srcFor(mine, 'fr');
  await new Promise((resolve) => { setTimeout(resolve, 20); });   /* the mark is not waited on */
  const heard = await app.db.getClip('natel|noun|fr|supertonic');
  assert.ok((heard?.lastUsed ?? 0) >= before, 'marked as heard, now');
  vi.restoreAllMocks();
});

test('the cap is off until asked for, at a size worth having', async () => {
  const { db } = await freshApp();
  const s = await db.getSettings();
  assert.equal(s.capClips, false);
  assert.ok(s.clipCacheMb >= 100, 'a sitting’s sentences are tens of megabytes');
});
