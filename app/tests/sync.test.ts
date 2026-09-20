import { test } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp } from './harness.js';
import { bit, card, ms, review, sec, sent, userWord } from './make.js';
import { SCHEMA } from '../src/lib/schema.js';

/** The server, as far as a sync is concerned: it records what it was pushed
 *  and answers with what it was told to. */
function server(pull: unknown = {}, cursor = 7, schema: number | null = SCHEMA): {
  calls: { since: number; schema?: number; push: Record<string, unknown[]> }[];
  fetchImpl: typeof fetch;
} {
  const calls: { since: number; schema?: number; push: Record<string, unknown[]> }[] = [];
  const fetchImpl: typeof fetch = async (_url, init): Promise<Response> => {
    calls.push(sent<typeof calls[number]>(init?.body));
    return new Response(JSON.stringify({ pull, cursor, schema }),
      { headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

/** A server whose history is longer than one reply: each call answers with
 *  the next page, `more` set on all but the last. */
function pagedServer(pages: { pull: unknown; cursor: number }[]): {
  calls: { since: number; push: Record<string, unknown[]> }[];
  fetchImpl: typeof fetch;
} {
  const calls: { since: number; push: Record<string, unknown[]> }[] = [];
  const fetchImpl: typeof fetch = async (_url, init): Promise<Response> => {
    calls.push(sent<typeof calls[number]>(init?.body));
    const page = pages[calls.length - 1];
    if (!page) return new Response('no more pages', { status: 500 });
    return new Response(
      JSON.stringify({ ...page, schema: SCHEMA, more: calls.length < pages.length }),
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

test('a history longer than one page arrives whole, in one sync', async () => {
  /* The server sends at most so many rows of a table per reply. Its cursor
     once meant "up to date" whatever the reply held: a fresh device on a
     long log stored the first page, stored a cursor past everything, and
     never asked for the rest. Now the reply says `more`, and the sync goes
     back for the next page from where the last one ended, until there is no
     more — one sync to the learner, one notice, one set of numbers. */
  const app = await signedIn();
  await app.db.logReview(review({ uid: 'mine', ts: sec(500) }));
  const heard: number[] = [];
  const stop = app.sync.onSync((r) => { heard.push(r.received.reviews); });

  const { calls, fetchImpl } = pagedServer([
    { pull: { reviews: [review({ uid: 'a', ts: sec(1000) }), review({ uid: 'b', ts: sec(2000) })] },
      cursor: 5 },
    /* The row at the join is sent by both pages, as the server does. */
    { pull: { reviews: [review({ uid: 'b', ts: sec(2000) }), review({ uid: 'c', ts: sec(3000) })],
      words: [userWord({ k: 'natel|noun', updatedAt: ms(900) })] },
      cursor: 9 },
  ]);
  const result = await app.sync.sync({ fetchImpl });
  stop();

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.since, 5, 'the second page is asked for from where the first ended');
  assert.deepEqual(calls[1]?.push.reviews, [], 'and pushes nothing: the push went with the first');
  assert.deepEqual((await app.db.allReviews()).map((r) => r.uid).sort(), ['a', 'b', 'c', 'mine'],
    'the row sent twice is stored once');
  assert.deepEqual((await app.db.userWords()).map((w) => w.k), ['natel|noun']);
  assert.equal(result.received.reviews, 3, 'the numbers are the sum of the pages');
  assert.equal(result.received.words, 1);
  assert.match(result.summary, /sent 1, received 4/);
  assert.deepEqual(heard, [3], 'told once, at the end');
  assert.equal((await app.sync.syncConfig()).cursor, 9, 'and the cursor is the last page’s');
  assert.equal((await app.db.allReviews()).find((r) => r.uid === 'mine')?.synced, true);
});

test('a lesson labelled here is labelled on the other device too', async () => {
  /* The lesson went up with the push from the first day; the pull never
     carried it back, so the other device had the words and no label, and
     the "Tuesday" the learner pasted them under was on one phone only. */
  const phone = await signedIn();
  await phone.words.addLessonText('le temps = time\nnatel = mobile phone', 'Tuesday');
  const up = server();
  await phone.sync.sync({ fetchImpl: up.fetchImpl });
  const pushed = up.calls[0]?.push.lessons as Record<string, unknown>[] | undefined;
  assert.equal(pushed?.length, 1, 'the lesson goes up');
  assert.equal(pushed?.[0]?.label, 'Tuesday');

  const laptop = await signedIn();
  const result = await laptop.sync.sync({
    fetchImpl: server({
      lessons: [...(pushed ?? []), { id: 7, label: 'not a lesson' }, { id: 'x', label: 3 }],
    }).fetchImpl,
  });
  assert.equal(result.received.lessons, 1, 'and the records that are not lessons are left out');
  assert.match(result.summary, /received 1/);
  const theirs = await laptop.db.lessons();
  assert.deepEqual(theirs.map((l) => l.label), ['Tuesday']);
  assert.deepEqual(theirs[0]?.keys, ['temps|noun', 'natel|unknown'], 'with the words it groups');

  /* The later label wins, whichever device gave it; an older copy does not
     undo a rename. */
  const renamed = { ...pushed?.[0], label: 'Tuesday, week 2', updatedAt: Date.now() + 1000 };
  await laptop.sync.sync({ fetchImpl: server({ lessons: [renamed] }).fetchImpl });
  await laptop.sync.sync({ fetchImpl: server({ lessons: [pushed?.[0]] }).fetchImpl });
  assert.deepEqual((await laptop.db.lessons()).map((l) => l.label), ['Tuesday, week 2']);
});

test('a server that says there is more but does not move the cursor on is an error, not a loop', async () => {
  const app = await signedIn();
  const fetchImpl: typeof fetch = async () => new Response(
    JSON.stringify({ pull: {}, cursor: 0, more: true, schema: SCHEMA }),
    { headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => app.sync.sync({ fetchImpl }), /where to carry on from/);
});

/* ---------------------------------------------------------------- schema -- */

/* The Worker says which schema it speaks in every reply (schema.ts), and
   the app looks before it writes. A build behind the Worker must not lay a
   shape it cannot read into its store, and a Worker behind the build has
   dropped whatever kind it did not know from the push. Either way nothing
   is written, nothing is marked sent, and the sync says so in a sentence. */

test('a Worker ahead of this build gets nothing written, and the cursor stays', async () => {
  const app = await signedIn();
  await app.db.logReview(review({ uid: 'mine', ts: sec(1000) }));
  const { calls, fetchImpl } = server({
    words: [userWord({ k: 'natel|noun', updatedAt: ms(900) })],
  }, 9, SCHEMA + 1);

  const result = await app.sync.sync({ fetchImpl });
  assert.equal(result.stale, 'app');
  assert.match(result.summary, /newer version/);
  assert.equal(calls.length, 1, 'one request, and no pages after it');
  assert.deepEqual(await app.words.activeUserWords(), [], 'the pull was not laid over the store');
  assert.equal((await app.sync.syncConfig()).cursor, 0, 'the cursor did not move');
  const { fetchImpl: again, calls: next } = server({}, 9);
  await app.sync.sync({ fetchImpl: again });
  assert.deepEqual(next[0]?.push.reviews?.map((r) => (r as { uid: string }).uid), ['mine'],
    'the review was not marked sent, so it goes again to a Worker that can take it');
});

test('a Worker behind this build is not written from, and the push goes again later', async () => {
  const app = await signedIn();
  await app.db.logReview(review({ uid: 'mine', ts: sec(1000) }));
  const behind = server({ words: [userWord({ k: 'natel|noun', updatedAt: ms(900) })] }, 9, SCHEMA - 1);
  const result = await app.sync.sync({ fetchImpl: behind.fetchImpl });
  assert.equal(result.stale, 'server');
  assert.deepEqual(await app.words.activeUserWords(), []);
  assert.equal((await app.sync.syncConfig()).cursor, 0);

  /* A Worker from before the number says nothing at all, which is behind. */
  const silent = server({}, 9, null);
  assert.equal((await app.sync.sync({ fetchImpl: silent.fetchImpl })).stale, 'server');

  const caughtUp = server({}, 9);
  await app.sync.sync({ fetchImpl: caughtUp.fetchImpl });
  assert.deepEqual(caughtUp.calls[0]?.push.reviews?.map((r) => (r as { uid: string }).uid), ['mine']);
  assert.equal(caughtUp.calls[0]?.schema, SCHEMA, 'and every request says what this build speaks');
});

test('a Worker that refuses the push as ahead of it is a Worker behind', async () => {
  const app = await signedIn();
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ schema: SCHEMA - 1 }),
    { status: 409, headers: { 'content-type': 'application/json' } });
  const result = await app.sync.sync({ fetchImpl });
  assert.equal(result.stale, 'server');
  assert.match(result.summary, /being updated/);
});

/* ---------------------------------------------------------------- update -- */

/* Update before you sync: a build that is waiting is taken before the first
   request goes out, so the sync runs on the code that wrote what it is about
   to read. The check is the service worker's; here it is handed in. */

/** A build waiting to step in, as far as a sync can tell. */
const build = (): ServiceWorker => ({ state: 'installed' } as unknown as ServiceWorker);

test('a build that is waiting is taken before the first request goes out', async () => {
  const app = await signedIn();
  const { calls, fetchImpl } = server();
  const stepped: ServiceWorker[] = [];
  const waiting = build();
  const result = await app.sync.sync({
    fetchImpl, checkUpdate: async () => waiting, applyUpdate: (w) => { stepped.push(w); },
  });
  assert.deepEqual(stepped, [waiting], 'the waiting build was stepped in');
  assert.equal(calls.length, 0, 'and nothing was asked of the server by the old build');
  assert.equal(result.stale, 'app');
  assert.match(result.summary, /new version is being installed/);
});

test('with no build waiting the sync goes ahead as before', async () => {
  const app = await signedIn();
  const { calls, fetchImpl } = server();
  const stepped: ServiceWorker[] = [];
  const result = await app.sync.sync({
    fetchImpl, checkUpdate: async () => null, applyUpdate: (w) => { stepped.push(w); },
  });
  assert.deepEqual(stepped, []);
  assert.equal(calls.length, 1);
  assert.equal(result.stale, undefined);
});

test('a Worker ahead of this build makes the app look once more for the build', async () => {
  const app = await signedIn();
  const { fetchImpl } = server({}, 9, SCHEMA + 1);
  let looked = 0;
  const found = build();
  const stepped: ServiceWorker[] = [];
  const result = await app.sync.sync({
    fetchImpl,
    /* Nothing the first time — the check missed — and the build the second. */
    checkUpdate: async () => (looked++ === 0 ? null : found),
    applyUpdate: (w) => { stepped.push(w); },
  });
  assert.equal(looked, 2);
  assert.deepEqual(stepped, [found]);
  assert.match(result.summary, /new version is being installed/);
});

test('no build is looked for, let alone taken, while a card is face up', async () => {
  const app = await signedIn();
  let looked = 0;
  const outcome = await app.sync.maybeAutoSync({
    busy: true, fetchImpl: server().fetchImpl, checkUpdate: async () => { looked += 1; return build(); },
  });
  assert.equal(outcome.ran, false);
  assert.equal(looked, 0);
});

/* ------------------------------------------------------------------ bits -- */

test('a bit opened here goes up, and one opened there comes down as the app\'s own record', async () => {
  const app = await signedIn();
  await app.db.putBit(bit('V.pc', { updatedAt: ms(500) }));
  const { calls, fetchImpl } = server({
    bits: [bit('V.imparfait', { updatedAt: ms(900) }), { id: 'nonsense' }],
  });
  await app.sync.sync({ fetchImpl });
  assert.deepEqual(calls[0]?.push.bits?.map((b) => (b as { id: string }).id), ['V.pc']);
  assert.deepEqual((await app.db.openBits()).map((b) => b.id).sort(), ['V.imparfait', 'V.pc'],
    'the pulled bit is stored, and a record that is not a bit is left out');
});
