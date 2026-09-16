/** The sync, as two of the learner's devices use it.
 *
 *  Each test is a phone and a laptop on the same account, pushing through
 *  POST /v1/sync and pulling with a cursor, against the real SQL. What is
 *  checked is what the other device ends up with, which is what the learner
 *  sees.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Push, WireWord } from '../src/env.js';
import { harness } from './env.js';
import type { Harness } from './env.js';

interface SyncReply { cursor: number; pushed: Record<string, number>; pull: Push }

/** One word of the learner's own, complete, as the app would send it. */
const word = (over: Partial<WireWord> = {}): WireWord => ({
  k: 'chat|noun', fr: 'chat', en: ['cat'], pos: 'noun', updatedAt: 1_000, ...over,
});

/** A device on an account: a token, and a sync call that returns the reply
 *  as the app reads it. */
async function device(h: Harness, email = 'learner@example.com') {
  const { token } = await h.signIn(email);
  return async (body: { since?: number; push?: Push } = {}): Promise<SyncReply> => {
    const res = await h.fetch('/v1/sync', { method: 'POST', token, json: { since: 0, ...body } });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    return JSON.parse(text) as SyncReply;
  };
}

/* The cursor is the server's counter as the device last saw it, and the pull
   asked for everything strictly past it — but rows are numbered from zero,
   so the row at exactly the cursor was never pulled. What that looked like:
   a fresh device never received the first word an account ever wrote, and a
   word added on its own on the phone never reached a laptop that was up to
   date. Nothing failed; the word was simply not there. */

test('the first record an account ever writes reaches the other device', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);

  await phone({ push: { words: [word()] } });
  const pulled = await laptop({ since: 0 });
  assert.deepEqual(pulled.pull.words, [word()]);
});

test('a word added on its own reaches a device whose cursor is current', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);

  await phone({ push: { words: [word()] } });
  const upToDate = await laptop({ since: 0 });
  assert.equal(upToDate.pull.words?.length, 1);

  const next = word({ k: 'chien|noun', fr: 'chien', en: ['dog'], updatedAt: 2_000 });
  await phone({ push: { words: [next] } });
  const later = await laptop({ since: upToDate.cursor });
  assert.deepEqual(later.pull.words, [next], 'the one word written since, not none');
});

test('a device that is up to date pulls nothing, not the last row again', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);

  await phone({ push: { words: [word()] } });
  const first = await laptop({ since: 0 });
  const again = await laptop({ since: first.cursor });
  assert.deepEqual(again.pull.words, []);
  assert.equal(again.cursor, first.cursor);
});
