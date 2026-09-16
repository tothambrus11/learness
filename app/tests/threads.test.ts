/** The voice's thread count, decided once from two facts about the device.
 *
 *  The rule used to live inline in the worker, where nothing could run it,
 *  and it asked for min(4, cores): every core of a four-core phone, and none
 *  for the screen. It also never mattered, because the page was not isolated
 *  and the runtime fell back to one thread without a word (#54).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { threadsFor } from '../src/lib/tts/threads.js';

test('the voice takes every core but one, and only when the page is isolated', () => {
  const table: [boolean, number | undefined, number][] = [
    /* not isolated: one thread, however many cores */
    [false, 1, 1],
    [false, 4, 1],
    [false, 8, 1],
    [false, undefined, 1],
    /* isolated: one for the screen, the rest for the voice, four at most */
    [true, 1, 1],
    [true, 2, 1],
    [true, 3, 2],
    [true, 4, 3],
    [true, 5, 4],
    [true, 8, 4],
    [true, 16, 4],
    /* a count the browser did not give, or gave badly */
    [true, undefined, 1],
    [true, 0, 1],
    [true, Number.NaN, 1],
    [true, Number.POSITIVE_INFINITY, 1],
    [true, -2, 1],
    [true, 3.7, 2],
  ];
  for (const [isolated, cores, threads] of table) {
    assert.equal(threadsFor({ isolated, cores }), threads, `isolated=${isolated} cores=${cores}`);
  }
});
