import { test } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp } from './harness.js';
import { card, ms, review, sec, sent, userWord } from './make.js';

/** The server, as far as a sync is concerned: it records what it was pushed
 *  and answers with what it was told to. */
function server(pull: unknown = {}, cursor = 7): {
  calls: { since: number; push: Record<string, unknown[]> }[];
  fetchImpl: typeof fetch;
} {
  const calls: { since: number; push: Record<string, unknown[]> }[] = [];
  const fetchImpl: typeof fetch = async (_url, init): Promise<Response> => {
    calls.push(sent<typeof calls[number]>(init?.body));
    return new Response(JSON.stringify({ pull, cursor }),
      { headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

async function signedIn(): Promise<Awaited<ReturnType<typeof freshApp>> & {
  sync: typeof import('../src/lib/sync.js');
}> {
  const app = await freshApp();
  const sync = await import('../src/lib/sync.js');
  await sync.configureSync({ api: 'https://example.test', token: 'a-token' });
  return { ...app, sync };
}

test('a push carries what changed, and a pull is laid over what is here', async () => {
  const app = await signedIn();
  await app.db.putCard(card('temps|noun', 'written', 'recognise', { updatedAt: ms(500) }));
  await app.db.logReview(review({ uid: 'mine', ts: sec(1000) }));

  const remote = card('jour|noun', 'written', 'recognise', { updatedAt: ms(900) });
  const { calls, fetchImpl } = server({
    cards: [remote],
    words: [userWord({ k: 'natel|noun', updatedAt: ms(900) })],
    reviews: [review({ uid: 'theirs', ts: sec(2000) })],
  });

  const result = await app.sync.sync({ fetchImpl });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.push.cards?.map((c) => (c as { key: string }).key), ['temps|noun']);
  assert.deepEqual(calls[0]?.push.reviews?.map((r) => (r as { uid: string }).uid), ['mine']);
  const pushed = calls[0]?.push.reviews?.[0] as Record<string, unknown> | undefined;
  assert.equal('i' in (pushed ?? {}), false,
    'the local auto-increment key means nothing on another device');

  assert.deepEqual((await app.db.allCards()).map((c) => c.key).sort(), ['jour|noun', 'temps|noun']);
  assert.deepEqual((await app.db.allReviews()).map((r) => r.uid).sort(), ['mine', 'theirs']);
  assert.deepEqual((await app.db.userWords()).map((w) => w.k), ['natel|noun']);
  assert.equal(result.received.cards, 1);
  assert.match(result.summary, /sent 2, received 3/);
});

test('the same pull twice adds nothing the second time', async () => {
  const app = await signedIn();
  const pull = { reviews: [review({ uid: 'theirs', ts: sec(2000) })] };
  await app.sync.sync({ fetchImpl: server(pull).fetchImpl });
  const after = await app.sync.sync({ fetchImpl: server(pull).fetchImpl });
  assert.equal((await app.db.allReviews()).length, 1);
  assert.equal(after.received.reviews, 0);
});

test('the server’s cursor is remembered, so neither clock has to be trusted', async () => {
  const app = await signedIn();
  const first = server({}, 42);
  await app.sync.sync({ fetchImpl: first.fetchImpl });
  assert.equal(first.calls[0]?.since, 0);
  const second = server({}, 43);
  await app.sync.sync({ fetchImpl: second.fetchImpl });
  assert.equal(second.calls[0]?.since, 42);
  assert.equal((await app.sync.syncConfig()).cursor, 43);
});

test('a sync that is not set up says so rather than failing quietly', async () => {
  await freshApp();
  const sync = await import('../src/lib/sync.js');
  await assert.rejects(() => sync.sync({ fetchImpl: server().fetchImpl }), /not set up/);
});

test('a refused token is reported as a refused token', async () => {
  const app = await signedIn();
  const fetchImpl: typeof fetch = async () => new Response('no', { status: 401 });
  await assert.rejects(() => app.sync.sync({ fetchImpl }), /was not accepted/);
});

test('an automatic sync respects the policy and the interval', async () => {
  const app = await signedIn();
  await app.db.setSetting('autoSync', 'off');
  assert.deepEqual(await app.sync.maybeAutoSync({ fetchImpl: server().fetchImpl }),
    { ran: false, reason: 'automatic sync is switched off' });

  await app.db.setSetting('autoSync', 'always');
  const ran = await app.sync.maybeAutoSync({ fetchImpl: server().fetchImpl });
  assert.equal(ran.ran, true);
  const again = await app.sync.maybeAutoSync({ fetchImpl: server().fetchImpl });
  assert.equal(again.ran, false, 'not twice in a minute');
  assert.match(again.reason, /min ago/);
});

test('signing out forgets the token and the cursor, and keeps the learning', async () => {
  const app = await signedIn();
  await app.db.putCard(card('temps|noun'));
  await app.sync.forgetSync();
  const cfg = await app.sync.syncConfig();
  assert.equal(cfg.token, '');
  assert.equal(cfg.cursor, 0);
  assert.equal((await app.db.allCards()).length, 1, 'progress is this device’s, not the server’s');
});

test('a review the server has seen is not pushed again', async () => {
  const app = await signedIn();
  await app.db.logReview(review({ uid: 'first', ts: sec(1000) }));
  await app.sync.sync({ fetchImpl: server().fetchImpl });

  await app.db.logReview(review({ uid: 'second', ts: sec(2000) }));
  const next = server();
  await app.sync.sync({ fetchImpl: next.fetchImpl });
  assert.deepEqual(next.calls[0]?.push.reviews?.map((r) => (r as { uid: string }).uid),
    ['second'],
    'the log is kept for ever; uploading all of it every quarter of an hour is not');
  assert.equal((await app.db.allReviews()).length, 2, 'and nothing was lost in the marking');
});

test('opening a sitting syncs even if it synced a minute ago, and waits at most a moment', async () => {
  const app = await signedIn();
  await app.db.setSetting('syncedAt', ms(Date.now()));
  const { calls, fetchImpl } = server({ words: [userWord({ k: 'natel|noun', updatedAt: ms(900) })] });
  await app.sync.pullOnOpen({ fetchImpl });
  assert.equal(calls.length, 1, 'the fifteen-minute rule does not apply on opening');
  assert.deepEqual((await app.db.userWords()).map((w) => w.k), ['natel|noun']);

  /* A server that never answers holds the sitting up for the timeout, no more. */
  const never: typeof fetch = () => new Promise<Response>(() => {});
  const before = Date.now();
  await app.sync.pullOnOpen({ fetchImpl: never, timeoutMs: 20 });
  assert.ok(Date.now() - before < 1000, 'dealt from what is here');

  /* Not set up: nothing is asked. */
  const fresh = await freshApp();
  const sync = await import('../src/lib/sync.js');
  let asked = 0;
  await sync.pullOnOpen({ fetchImpl: (): Promise<Response> => { asked += 1; return never(''); } });
  assert.equal(asked, 0);
  void fresh;
});

test('anyone who asks is told when a sync finished', async () => {
  const app = await signedIn();
  const heard: string[] = [];
  const stop = app.sync.onSync((r) => { heard.push(r.summary); });
  await app.sync.sync({ fetchImpl: server({}).fetchImpl });
  assert.deepEqual(heard, ['Already up to date']);
  stop();
  await app.sync.sync({ fetchImpl: server({}).fetchImpl });
  assert.equal(heard.length, 1, 'and not after unsubscribing');
});
