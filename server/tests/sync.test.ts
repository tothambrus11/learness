/** The sync, as two of the learner's devices use it.
 *
 *  Each test is a phone and a laptop on the same account, pushing through
 *  POST /v1/sync and pulling with a cursor, against the real SQL. What is
 *  checked is what the other device ends up with, which is what the learner
 *  sees: a record made here appears there, the later edit wins, a deletion
 *  travels and is not undone by a device that never heard of it.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { Push, WireReview, WireTheme, WireWord } from '../src/env.js';
import { PULL_PAGE } from '../src/worker.js';
import { harness } from './env.js';
import type { Harness } from './env.js';

interface SyncReply {
  cursor: number; more: boolean; pushed: Record<string, number>; pull: Push;
}

/** One word of the learner's own, complete, as the app would send it. */
const word = (over: Partial<WireWord> = {}): WireWord => ({
  k: 'chat|noun', fr: 'chat', en: ['cat'], pos: 'noun', updatedAt: 1_000, ...over,
});

/** One theme, complete, as the app would send it. */
const theme = (over: Partial<WireTheme> = {}): WireTheme => ({
  id: 'sepia', name: 'Sepia', mode: 'light', basedOn: 'paper',
  colours: { bg: '#f4ecd8', ink: '#3b2f2f' }, updatedAt: 1_000, ...over,
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

/* ---------------------------------------------------------------- cursor -- */

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

/* ----------------------------------------------------------------- pages -- */

/* A reply carries at most PULL_PAGE rows of each table. It once carried the
   counter as its cursor whatever it held, and there was no `more`: a fresh
   device on twelve thousand reviews received the first five thousand,
   stored a cursor past all of them, and never asked for the rest. Nothing
   failed; the history was simply shorter on that device. */

/** One review, complete, as the app would send it. */
const review = (n: number): WireReview => ({
  uid: `r${n}`, key: 'chat|noun', id: 'chat|noun|written|recognise', direction: 'written/recognise',
  ts: 1_700_000_000 + n, rating: 3, ms: null, state: 2,
});

/** The app's side of the pull: follow `cursor` while `more`, and count what
 *  each page carried. */
async function pullEverything(pull: (body: { since: number }) => Promise<SyncReply>) {
  const reviews = new Map<string, number>();
  const words = new Map<string, number>();
  let since = 0;
  let pages = 0;
  for (;;) {
    const page = await pull({ since });
    pages += 1;
    for (const r of page.pull.reviews ?? []) reviews.set(r.uid, (reviews.get(r.uid) ?? 0) + 1);
    for (const w of page.pull.words ?? []) words.set(w.k, (words.get(w.k) ?? 0) + 1);
    if (!page.more) return { reviews, words, pages, cursor: page.cursor };
    assert.ok(page.cursor > since, 'a page with more to come moves the cursor on');
    since = page.cursor;
  }
}

test('a history longer than one page reaches a fresh device whole, a page at a time', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);

  /* One table well past the cap, another well under it, written in turns so
     their sequence numbers interleave as a real account's do. */
  const total = PULL_PAGE + 1_500;
  const chunk = 1_000;
  for (let from = 0; from < total; from += chunk) {
    const reviews = Array.from({ length: Math.min(chunk, total - from) }, (_, i) => review(from + i));
    const k = `mot${from / chunk}|noun`;
    await phone({ push: { reviews, words: [word({ k, fr: k, updatedAt: 1_000 + from })] } });
  }
  /* Rows are numbered from zero, one number per row pushed: the counter is
     how many were pushed. (A pull from zero would say so too, but it is
     paged now, and its cursor is the page's, not the counter.) */
  const counter = total + Math.ceil(total / chunk);

  const got = await pullEverything(laptop);
  assert.equal(got.pages, 2, 'two pages for one and a half caps of reviews');
  assert.equal(got.reviews.size, total, 'every review reached the laptop');
  assert.equal(got.words.size, Math.ceil(total / chunk), 'and every word');
  /* The row at the join of two pages is sent by both, which the app already
     takes in its stride; nothing else is sent twice. */
  const twice = [...got.reviews.values()].filter((n) => n > 1).length;
  assert.ok(twice <= got.pages - 1, `${twice} reviews sent twice, for ${got.pages} pages`);
  assert.ok([...got.words.values()].every((n) => n <= got.pages));
  assert.equal(got.cursor, counter, 'and the laptop ends at the counter, up to date');
  assert.equal((await laptop({ since: got.cursor })).more, false);
});

test('a page that is exactly full says there may be more, and the next says there is not', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);
  await phone({ push: { reviews: Array.from({ length: PULL_PAGE }, (_, i) => review(i)) } });

  const first = await laptop({ since: 0 });
  assert.equal(first.pull.reviews?.length, PULL_PAGE);
  assert.equal(first.more, true, 'the server cannot tell a full page from a page with more behind it');
  assert.equal(first.cursor, PULL_PAGE - 1, 'so the cursor is the last row sent, not the counter');
  const second = await laptop({ since: first.cursor });
  assert.deepEqual(second.pull.reviews?.map((r) => r.uid), [`r${PULL_PAGE - 1}`]);
  assert.equal(second.more, false);
  assert.equal(second.cursor, PULL_PAGE);
});

/* ---------------------------------------------------------------- themes -- */

/* A colour theme the learner made is backed-up data (#66), which in this app
   means it goes through the sync, the same way as the learner's own words. */

test('a theme made on one device comes back to the other', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);

  const pushed = await phone({ push: { themes: [theme()] } });
  assert.equal(pushed.pushed.themes, 1);

  const pulled = await laptop({ since: 0 });
  assert.deepEqual(pulled.pull.themes, [theme()], 'the record comes back exactly as it went in');
  assert.equal(pulled.cursor, pushed.cursor);
});

test('the later edit of a theme wins whichever device sent it first', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);
  const later = theme({ name: 'Sepia, warmer', colours: { bg: '#f7efdc' }, updatedAt: 3_000 });
  const earlier = theme({ name: 'Sepia, cooler', updatedAt: 2_000 });

  /* The laptop's edit is the later one but the phone's reaches the server
     first: last write wins by the moment of the edit, not the order of the
     uploads, or an offline phone would overwrite a whole afternoon's work. */
  await laptop({ push: { themes: [later] } });
  await phone({ push: { themes: [earlier] } });

  const pulled = await laptop({ since: 0 });
  assert.deepEqual(pulled.pull.themes, [later]);
});

test('a theme deleted on one device is gone on the other, not brought back', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);

  await phone({ push: { themes: [theme()] } });
  await laptop({ since: 0 });
  const gone = theme({ updatedAt: 2_000, deleted: true });
  await laptop({ push: { themes: [gone] } });

  /* The phone, still holding its copy, sends it again: an older record does
     not revive a deleted theme. */
  await phone({ push: { themes: [theme()] } });

  const pulled = await laptop({ since: 0 });
  assert.deepEqual(pulled.pull.themes, [gone], 'the tombstone is what every device now holds');
});

test('a device that sends no themes still syncs and pulls what the other made', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);

  await phone({ push: { themes: [theme()] } });
  /* An app from before themes pushes words and nothing else. */
  const reply = await laptop({ since: 0, push: { words: [word()] } });

  assert.equal(reply.pushed.themes, 0);
  assert.equal(reply.pushed.words, 1);
  assert.deepEqual(reply.pull.themes, [theme()]);
});

test('a device pulls only the themes changed since its cursor', async () => {
  const h = harness();
  const phone = await device(h);
  const laptop = await device(h);

  const first = await phone({ push: { themes: [theme()] } });
  const caughtUp = await laptop({ since: first.cursor });
  assert.deepEqual(caughtUp.pull.themes, [], 'nothing new since the last look');

  const second = theme({ id: 'a-uuid', name: 'Night', mode: 'dark', updatedAt: 2_000 });
  await phone({ push: { themes: [second] } });
  const behind = await laptop({ since: first.cursor });
  assert.deepEqual(behind.pull.themes, [second], 'only what changed, not the whole set again');
});

test("a theme is the learner's own: another account never sees it", async () => {
  const h = harness();
  const mine = await device(h, 'me@example.com');
  const theirs = await device(h, 'someone-else@example.com');

  await mine({ push: { themes: [theme()] } });
  const pulled = await theirs({ since: 0 });
  assert.deepEqual(pulled.pull.themes, []);
});
