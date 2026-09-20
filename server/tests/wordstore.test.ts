/** The account's sequence counter, which is what a device's cursor is
 *  measured against.
 *
 *  It was moved on with an UPDATE and read back with a SELECT. Two syncs on
 *  one account at once — the phone and the laptop coming back into view
 *  together, or a retry crossing the request it retried — could each move
 *  it, each read the sum, and stamp two rows with the same number; and a
 *  cursor taken between a request's UPDATE and its rows going in stood past
 *  rows that were not there yet, which the device then never pulled. Now
 *  the move and the read are one statement, and the rows go in the same
 *  batch as the reservation, which D1 runs as one transaction. These tests
 *  run that SQL on SQLite itself, with the real migrations applied.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Env } from '../src/env.js';
import { currentSeq, nextSeq, seqRun } from '../src/wordstore.js';
import { testDatabase } from './d1.js';

const fresh = (): { env: Env; sqlite: ReturnType<typeof testDatabase>['sqlite'] } => {
  const { d1, sqlite } = testDatabase();
  return { env: { DB: d1, ASSETS: null as unknown as Fetcher }, sqlite };
};

test('two reservations in a row never hand out the same number, and the counter is where the last ended', async () => {
  const { env } = fresh();
  assert.equal(await currentSeq(env, 'u'), 0, 'an account starts at zero');
  const first = await nextSeq(env, 'u', 3);
  const second = await nextSeq(env, 'u', 2);
  assert.equal(first, 0, 'rows are numbered from zero');
  assert.equal(second, 3, 'the next run starts where the last one ended');
  assert.equal(await currentSeq(env, 'u'), 5,
    'the number returned is the stored value less the run: the first number reserved');
});

test('the counter is one account’s: reserving on one does not move another’s', async () => {
  const { env } = fresh();
  await nextSeq(env, 'me', 4);
  assert.equal(await nextSeq(env, 'someone-else', 1), 0);
  assert.equal(await currentSeq(env, 'me'), 4);
});

test('rows are stamped in the same transaction as the counter that numbers them', async () => {
  const { env, sqlite } = fresh();
  const insert = (run: ReturnType<typeof seqRun>, k: string, i: number) => env.DB.prepare(
    `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,0,${run.at})`)
    .bind('u', k, '{}', 1, ...run.binds(i));

  const one = seqRun(env, 'u', 3);
  await env.DB.batch([one.reserve, insert(one, 'a', 0), insert(one, 'b', 1), insert(one, 'c', 2)]);
  const two = seqRun(env, 'u', 2);
  await env.DB.batch([two.reserve, insert(two, 'd', 0), insert(two, 'e', 1)]);

  const stamped = (sqlite.prepare('SELECT k, seq FROM words ORDER BY seq').all() as { k: string; seq: number }[])
    .map(({ k, seq }) => ({ k, seq }));
  assert.deepEqual(stamped, [
    { k: 'a', seq: 0 }, { k: 'b', seq: 1 }, { k: 'c', seq: 2 }, { k: 'd', seq: 3 }, { k: 'e', seq: 4 },
  ]);
  assert.equal(await currentSeq(env, 'u'), 5, 'the counter is the first number not on a row');
});

test('a batch that fails leaves the counter where it was: no number without a row behind it', async () => {
  /* A cursor is measured against the counter; a number handed out for a row
     that never went in would be a gap a device could not tell from a row
     it had missed. The stand-in rolls the batch back as D1 does. */
  const { env, sqlite } = fresh();
  const run = seqRun(env, 'u', 2);
  await assert.rejects(env.DB.batch([
    run.reserve,
    env.DB.prepare(
      `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,0,${run.at})`)
      .bind('u', 'a', '{}', 1, ...run.binds(0)),
    env.DB.prepare('INSERT INTO no_such_table (x) VALUES (1)'),
  ]));
  assert.equal(await currentSeq(env, 'u'), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM words').get()?.n, 0);
});
