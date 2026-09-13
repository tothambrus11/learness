/** What went wrong is written down, kept, and put into the bug report.
 *
 *  A missing recording used to fail in the console and nowhere else (#31);
 *  the learner's report said the button did nothing. The notes are the
 *  cause, carried with the report.
 */
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp } from './harness.js';

async function fresh(): Promise<typeof import('../src/lib/diagnostics.js')> {
  await freshApp();
  return import('../src/lib/diagnostics.js');
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
  await new Promise((resolve) => { setTimeout(resolve, 20); });   /* the store write */
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
