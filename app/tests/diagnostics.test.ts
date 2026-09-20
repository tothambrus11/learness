/** What went wrong is written down, kept, and put into the bug report.
 *
 *  A missing recording used to fail in the console and nowhere else (#31);
 *  the learner's report said the button did nothing. The notes are the
 *  cause, carried with the report.
 */
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp } from './harness.js';
import { SCHEMA } from '../src/lib/schema.js';

async function fresh(): Promise<typeof import('../src/lib/diagnostics.js')> {
  app = await freshApp();
  return import('../src/lib/diagnostics.js');
}

let app: Awaited<ReturnType<typeof freshApp>>;

/** Wait for what a note's own write put in the store.
 *
 *  Reporting never waits — the store may be the thing that failed — so a test
 *  that wants to see the write has to watch for it. This used to be a 20ms
 *  sleep, which is a guess about a database on a machine running forty test
 *  files at once, and it lost that bet about one run in ten.
 */
async function written(count: number): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    const saved = await app.db.getMeta<unknown[]>('diagnostics');
    if ((saved?.length ?? 0) >= count) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error(`the store never got ${count} note(s)`);
}

test('a note is kept, the same note twice is one, and only the last few are kept', async () => {
  const d = await fresh();
  d.report('sound', 'This word’s recording is missing.');
  d.report('sound', 'This word’s recording is missing.');
  d.report('sound', '  ');
  assert.equal(d.all().length, 1, 'pressing the button three times is one thing wrong');
  for (let i = 0; i < d.KEEP + 5; i += 1) d.report('media', `clip ${i} could not be fetched`);
  assert.equal(d.all().length, d.KEEP);
  assert.equal(d.all()[0]?.what, 'clip 5 could not be fetched', 'the oldest go first');
});

test('the notes survive a reload', async () => {
  const d = await fresh();
  d.report('sync', 'Sync failed (500)');
  await written(1);
  vi.resetModules();
  const again = await import('../src/lib/diagnostics.js');
  assert.equal(again.all().length, 0, 'nothing in memory yet');
  again.report('voice', 'the voice worker failed');
  const notes = await again.load();
  assert.deepEqual(notes.map((n) => `${n.where}: ${n.what}`),
    ['sync: Sync failed (500)', 'voice: the voice worker failed'],
    'what was written before comes first, and what this load wrote is kept');
  again.clear();
  assert.equal(again.all().length, 0);
});

test('the report carries the notes newest first, and the environment', async () => {
  const d = await fresh();
  d.report('sound', 'first');
  d.report('media', 'second');
  const body = d.reportBody({ online: false, connection: 'on a metered connection', voice: true,
    signedIn: false, agent: 'TestBrowser/1' });
  assert.ok(body.indexOf('media: second') < body.indexOf('sound: first'), 'newest first');
  assert.ok(body.includes('build test-build · offline, on a metered connection · voice on device · not signed in'));
  assert.ok(body.endsWith('TestBrowser/1'));
  const url = d.issueUrl({});
  assert.ok(url.startsWith(`${d.ISSUES}?body=`));
  assert.ok(decodeURIComponent(url).includes('media: second'));
});

test('a link that would not fit drops the oldest notes until it does', async () => {
  const d = await fresh();
  for (let i = 0; i < 30; i += 1) d.report('media', `${'x'.repeat(200)} ${i}`);
  const url = d.issueUrl({}, d.all(), 3000);
  assert.ok(url.length <= 3000);
  assert.ok(decodeURIComponent(url).includes(' 29'), 'the newest is what survives');
  assert.equal(decodeURIComponent(url).includes(' 0\n'), false);
});

test('listeners hear every note, and stop when told', async () => {
  const d = await fresh();
  const seen: number[] = [];
  const stop = d.onNotes((notes) => { seen.push(notes.length); });
  d.report('app', 'boom');
  stop();
  d.report('app', 'again');
  assert.deepEqual(seen, [0, 1]);
});

test('a report names the browser it was sent from once, and no other', async () => {
  /* Asked for as #71, from a phone that syncs with a desktop: a report should
     name this device's browser and not every browser the learner is signed
     in on. It never did otherwise — the agent is asked of the browser the
     button is pressed in, once, as the last line, and a note has no browser
     in it — but nothing said so. The other half of the rule is that a note
     is about the device it was written on: it lives in the `meta` store,
     which the sync has no table for and the export leaves out, so the
     desktop's "no French voice" is never quoted under the phone's browser. */
  const d = await fresh();
  d.report('sound', 'No French voice on this device to read the sentence with.');
  d.report('media', '1 recording could not be fetched: frcog-5585.mp3');
  await written(2);

  const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/153.0.0.0';
  const lines = d.reportBody({ agent, voice: false }, d.all()).split('\n');
  assert.equal(lines.filter((line) => line.includes('Mozilla/')).length, 1,
    'the browser is named once');
  assert.equal(lines.at(-1), agent, 'as the last line, after the build line');
  for (const note of d.all()) {
    assert.deepEqual(Object.keys(note).sort(), ['at', 'what', 'where'],
      'a note is when, where and what: no browser travels with it');
  }

  const exported = JSON.stringify(await app.db.exportProgress());
  assert.equal(exported.includes('frcog-5585'), false, 'the export leaves the notes out');
  const sync = await import('../src/lib/sync.js');
  await sync.configureSync({ api: 'https://example.test', token: 'a-token' });
  let pushed = '';
  const fetchImpl: typeof fetch = async (_url, init): Promise<Response> => {
    pushed = typeof init?.body === 'string' ? init.body : '';
    return new Response(JSON.stringify({ pull: {}, cursor: 1, schema: SCHEMA }),
      { headers: { 'content-type': 'application/json' } });
  };
  await sync.sync({ fetchImpl });
  assert.ok(pushed.length, 'a push went out');
  assert.equal(pushed.includes('frcog-5585'), false, 'and the notes were not in it');
});

test('a listener that throws is written down, and the ones after it are still called', async () => {
  const { all, notify } = await fresh();
  const heard: number[] = [];
  const listeners = [
    (n: number): void => { heard.push(n); },
    (): void => { throw new Error('a screen’s bug'); },
    (n: number): void => { heard.push(n * 10); },
  ];
  notify(listeners, 4, 'voice', 'a watcher of the voice queue failed');
  assert.deepEqual(heard, [4, 40]);
  assert.deepEqual(all().map((n) => [n.where, n.what]),
    [['voice', 'a watcher of the voice queue failed: a screen’s bug']]);
});

