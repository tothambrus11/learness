/** The audio owed to your own words, and the feeder that pays it.
 *
 *  Driven over the real queue and a fake voice, so what is asserted is what
 *  the voice was asked for and in what order — the invariant being that the
 *  backlog has one job out at a time and everything that wants the voice
 *  more urgently goes first.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createFeeder, mayFeed, outstanding, wordPhrase } from '../src/lib/backlog.js';
import type { BacklogState } from '../src/lib/backlog.js';
import { MB } from '../src/lib/clipcache.js';
import { createVoiceQueue } from '../src/lib/voicequeue.js';
import type { ClipRecord } from '../src/lib/tts.js';
import type { UserWord } from '../src/lib/model.js';
import { fakeVoice, madeClip, settle } from './fakevoice.js';
import { ms, userWord } from './make.js';

const fr = (key: string, text: string): ClipRecord =>
  ({ key, kind: 'fr', engine: 'supertonic', text });

const natel = userWord({ k: 'natel|noun', fr: 'natel', pos: 'noun', gender: 'm', addedAt: ms(3) });
const bus = userWord({ k: 'bus|noun', fr: 'bus', pos: 'noun', gender: 'm', addedAt: ms(2) });
const jour = userWord({ k: 'jour|noun', fr: 'jour', pos: 'noun', gender: 'm', addedAt: ms(1) });

/* ------------------------------------------------------------ the planner -- */

test('the newest of your words is made first, and the one you are looking at before that', () => {
  const owed = outstanding([jour, bus, natel], []);
  assert.deepEqual(owed.map((o) => o.word.k), ['natel|noun', 'bus|noun', 'jour|noun']);
  assert.deepEqual(outstanding([jour, bus, natel], [], { prefer: jour.k }).map((o) => o.word.k),
    ['jour|noun', 'natel|noun', 'bus|noun'], 'the open word jumps the rest');
  assert.deepEqual(outstanding([jour, bus, natel], [], { prefer: natel.k }).map((o) => o.word.k),
    ['natel|noun', 'bus|noun', 'jour|noun'], 'and preferring the first changes nothing');
  assert.equal(wordPhrase(natel).text, 'le natel', 'worded the way the clip is checked');
});

test('a word promoted from the catalogue, one with no French, and one set aside are not the voice’s to make', () => {
  const promoted = userWord({ k: 'bug|noun', fr: 'le bug', source: 'catalogue', addedAt: ms(9) });
  const blank = userWord({ k: 'x|noun', fr: '', addedAt: ms(8) });
  const gone = userWord({ k: 'y|noun', fr: 'y', deleted: true, addedAt: ms(7) });
  const owed = outstanding([promoted, blank, gone, natel, bus], [], { skip: new Set([bus.k]) });
  assert.deepEqual(owed.map((o) => o.word.k), ['natel|noun']);
});

test('a clip that no longer says what the word says is owed again', () => {
  const owed = outstanding([natel, bus], [fr('natel|noun', 'le natel'), fr('bus|noun', 'le car')]);
  assert.deepEqual(owed.map((o) => [o.word.k, o.state]), [['bus|noun', 'stale']]);
});

test('why the backlog holds is a table', () => {
  const go = { voiceReady: true, eager: true, manual: false, room: true };
  assert.deepEqual(mayFeed(go), { ok: true });
  assert.deepEqual(mayFeed({ ...go, voiceReady: false }), { ok: false, why: 'no voice' });
  assert.deepEqual(mayFeed({ ...go, eager: false }), { ok: false, why: 'on demand' });
  assert.deepEqual(mayFeed({ ...go, eager: false, manual: true }), { ok: true },
    'a press is not held by the setting');
  assert.deepEqual(mayFeed({ ...go, room: false }), { ok: false, why: 'cache full' });
});

/* ------------------------------------------------------------- the feeder -- */

/** The app around a feeder, as closures over arrays the test can change. */
function world(words: UserWord[]) {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  const reports: string[] = [];
  const madeKeys: string[] = [];
  const states: BacklogState[] = [];
  const app = {
    words, clips: [] as ClipRecord[], ready: true, eagerVoice: true,
    capClips: false, clipCacheMb: 200, size: { clips: 0, bytes: 0 },
  };
  const feeder = createFeeder({
    queue,
    words: async () => app.words,
    clips: async () => app.clips,
    cache: async () => app.size,
    settings: async () => ({ eagerVoice: app.eagerVoice, capClips: app.capClips,
      clipCacheMb: app.clipCacheMb }),
    voiceReady: async () => app.ready,
    report: (what) => { reports.push(what); },
    made: (key) => { madeKeys.push(key); },
  });
  feeder.onState((s) => { states.push(s); });
  /** Let the voice finish the word it is on — made, or not — and keep the
   *  clip the way the store would. */
  const finish = async (made = true): Promise<void> => {
    const text = voice.made.at(-1)!;
    const key = feeder.state.current!.key;
    if (made) app.clips.push(fr(key, text));
    voice.release(made ? madeClip({ key, slot: 'word', text }) : null);
    await settle();
    await settle();
  };
  const start = async (): Promise<void> => { feeder.rescan(); await settle(); await settle(); };
  return { voice, queue, feeder, reports, madeKeys, states, app, finish, start };
}

test('exactly one of the backlog’s phrases is in the queue at a time', async () => {
  const w = world([jour, bus, natel]);
  await w.start();
  assert.deepEqual(w.voice.made, ['le natel'], 'the newest, and only it');
  assert.equal(w.queue.waiting, 0, 'nothing queued behind it');
  assert.deepEqual(w.feeder.state.current, { key: 'natel|noun', text: 'le natel' });
  assert.deepEqual(w.feeder.state.pending,
    { 'natel|noun': 'missing', 'bus|noun': 'missing', 'jour|noun': 'missing' });
  await w.finish();
  assert.deepEqual(w.voice.made, ['le natel', 'le bus'], 'the next, once that one ended');
  assert.deepEqual(w.madeKeys, ['natel|noun'], 'and the app was told');
  await w.finish();
  await w.finish();
  assert.deepEqual(w.voice.made, ['le natel', 'le bus', 'le jour']);
  assert.equal(w.feeder.state.running, false, 'the run is over');
  assert.deepEqual(w.feeder.state.pending, {});
  assert.equal(w.feeder.state.why, '');
});

test('done and total count the run, and are recounted when the list grows under it', async () => {
  const w = world([jour, bus, natel]);
  await w.start();
  assert.deepEqual([w.feeder.state.done, w.feeder.state.total], [0, 3]);
  await w.finish();
  assert.deepEqual([w.feeder.state.done, w.feeder.state.total], [1, 3]);
  w.app.words = [...w.app.words, userWord({ k: 'gare|noun', fr: 'gare', pos: 'noun', gender: 'f',
    addedAt: ms(9) })];
  w.feeder.rescan();
  await settle();
  assert.deepEqual([w.feeder.state.done, w.feeder.state.total], [1, 4], 'one more to make');
  await w.finish();
  assert.deepEqual(w.voice.made, ['le natel', 'le bus', 'la gare'],
    'the word added while it ran is next: the newest');
});

test('a job the sitting’s leaving forgot is fed again, not set aside', async () => {
  const w = world([natel, bus]);
  /* The sitting's own warm-up is on the voice; the backlog's job waits. */
  w.queue.warm([{ key: 'parler|verb', slot: 'conj:pres:0', text: 'je parle' }]);
  await w.start();
  assert.equal(w.queue.waiting, 1, 'the backlog’s job, behind the sitting’s');
  w.queue.clear();                                     /* leaving the study screen */
  await settle();
  assert.equal(w.queue.waiting, 1, 'fed again at once');
  assert.deepEqual(w.feeder.state.failed, []);
  w.voice.release();                                   /* "je parle" finishes */
  await settle();
  assert.deepEqual(w.voice.made, ['je parle', 'le natel']);
});

test('a hover is served before the backlog', async () => {
  const w = world([natel]);
  w.queue.warm([{ key: 'parler|verb', slot: 'conj:pres:0', text: 'je parle' }]);
  await w.start();
  void w.queue.want({ key: 'parler|verb', slot: 'conj:pres:1', text: 'tu parles' });
  w.voice.release();
  await settle();
  assert.deepEqual(w.voice.made, ['je parle', 'tu parles'], 'the hovered form, not the backlog’s');
});

test('nothing is fed once the cache has no room, and the reason is said', async () => {
  const w = world([natel, bus]);
  w.app.capClips = true;
  w.app.clipCacheMb = 1;
  w.app.size = { clips: 4, bytes: 0.9 * MB };
  await w.start();
  assert.deepEqual(w.voice.made, []);
  assert.equal(w.feeder.state.why, 'cache full');
  assert.equal(w.feeder.state.running, false);
  assert.deepEqual(Object.keys(w.feeder.state.pending), ['natel|noun', 'bus|noun'],
    'still owed, and the panel can say so');
  w.app.size = { clips: 0, bytes: 0 };                /* the cap was raised, or the cache cleared */
  w.feeder.rescan();
  await settle();
  assert.deepEqual(w.voice.made, ['le natel']);
  assert.equal(w.feeder.state.why, '');
});

test('nothing is fed without the voice, and it is never fetched on the backlog’s account', async () => {
  const w = world([natel]);
  w.app.ready = false;
  await w.start();
  assert.deepEqual(w.voice.made, []);
  assert.equal(w.feeder.state.why, 'no voice');
});

test('on demand, nothing is made until asked once; then one pass, and the setting holds again', async () => {
  const w = world([natel, bus]);
  w.app.eagerVoice = false;
  await w.start();
  assert.deepEqual(w.voice.made, []);
  assert.equal(w.feeder.state.why, 'on demand');
  w.feeder.runOnce();
  await settle();
  await settle();
  assert.deepEqual(w.voice.made, ['le natel']);
  assert.equal(w.feeder.state.manual, true, 'a run that can be called off');
  await w.finish();
  await w.finish();
  assert.deepEqual(w.voice.made, ['le natel', 'le bus']);
  assert.equal(w.feeder.state.manual, false, 'the pass is over');
  w.app.words = [...w.app.words, userWord({ k: 'gare|noun', fr: 'gare', pos: 'noun', gender: 'f',
    addedAt: ms(9) })];
  w.feeder.rescan();
  await settle();
  assert.deepEqual(w.voice.made, ['le natel', 'le bus'], 'a new word waits for the next press');
  assert.equal(w.feeder.state.why, 'on demand');
});

test('a run asked for with a press can be called off; what is being made finishes', async () => {
  const w = world([natel, bus, jour]);
  w.app.eagerVoice = false;
  w.feeder.runOnce();
  await settle();
  await settle();
  w.feeder.stopRun();
  await settle();
  await w.finish();
  assert.deepEqual(w.voice.made, ['le natel'], 'the one on the voice, and no more');
  assert.equal(w.feeder.state.why, 'on demand');
  assert.deepEqual(Object.keys(w.feeder.state.pending), ['bus|noun', 'jour|noun'], 'still owed');
});

test('a word the voice could not make is set aside and written down once', async () => {
  const w = world([natel, bus]);
  await w.start();
  await w.finish(false);
  assert.deepEqual(w.feeder.state.failed, ['natel|noun']);
  assert.deepEqual(w.reports, ['the voice could not make “le natel”']);
  assert.deepEqual(w.voice.made, ['le natel', 'le bus'], 'the run goes on without it');
  await w.finish();
  w.feeder.rescan();
  await settle();
  assert.deepEqual(w.voice.made, ['le natel', 'le bus'], 'not asked for again this session');
  assert.equal(w.reports.length, 1);
  assert.deepEqual(w.feeder.state.pending, {}, 'nor counted as owed');
  /* The voice arriving is the one moment a failure is worth another try. */
  w.feeder.rescan({ retryFailed: true });
  await settle();
  assert.deepEqual(w.voice.made, ['le natel', 'le bus', 'le natel']);
  assert.deepEqual(w.feeder.state.failed, []);
});

test('the word being looked at is made next, and moved up if it is already queued', async () => {
  const w = world([jour, bus, natel]);
  await w.start();
  w.feeder.prefer(jour.k);
  await w.finish();
  assert.deepEqual(w.voice.made, ['le natel', 'le jour'], 'ahead of the bus');
});

test('a screen is told how the backlog stands, at once and after every change', async () => {
  const w = world([natel]);
  assert.equal(w.states.length, 1, 'told at once');
  assert.deepEqual(w.states[0], { running: false, manual: false, done: 0, total: 0, current: null,
    pending: {}, failed: [], why: '' });
  await w.start();
  const last = w.states.at(-1)!;
  assert.equal(last.running, true);
  assert.equal(last.current?.key, 'natel|noun');
  w.feeder.stop();
  await w.finish();
  assert.equal(w.feeder.state.running, true, 'stopped watching: nothing more is heard');
});
