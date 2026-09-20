/** What the audio panel says, over every state it can be in. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { voicePanel } from '../src/lib/voicepanel.js';
import type { PanelInput } from '../src/lib/voicepanel.js';
import type { BacklogState } from '../src/lib/backlog.js';
import { k } from './make.js';

const idle: BacklogState = {
  running: false, manual: false, done: 0, total: 0, current: null, pending: {}, failed: [], why: '',
};
const base: PanelInput = {
  backlog: idle, voice: { phase: 'ready', text: '', progress: 1 }, word: null, summary: true,
  fetching: false, asking: false, making: false, capMb: 200,
};
const owed = (pending: BacklogState['pending'], why: BacklogState['why'] = ''): BacklogState =>
  ({ ...idle, pending, why });
const natel = { k: k('natel|noun') };

test('a word’s own panel says where its audio stands, and offers the one thing to do about it', () => {
  const row = (backlog: BacklogState, over: Partial<PanelInput> = {}) =>
    voicePanel({ ...base, backlog, word: natel, summary: false, ...over });
  assert.equal(row(idle), null, 'nothing owed: nothing said');
  assert.deepEqual(pick(row(owed({ 'natel|noun': 'missing' }, 'on demand'))),
    ['held', 'No audio yet', 'make', 'Make audio', false]);
  assert.deepEqual(pick(row(owed({ 'natel|noun': 'stale' }, 'no voice'))),
    ['held', 'Audio is out of date', 'make', 'Make it again', true], 'the old spelling is a warning');
  assert.deepEqual(pick(row(owed({ 'natel|noun': 'missing' }))),
    ['waiting', 'No audio yet · waiting its turn', 'next', 'Make it next', false],
    'the backlog will get to it; a press moves it up');
  assert.deepEqual(pick(row(owed({ 'natel|noun': 'missing' }), { making: true })),
    ['making', 'Making audio…', null, '', false]);
  assert.equal(row(owed({ 'natel|noun': 'missing' }), { making: true })?.spinner, true);
  assert.deepEqual(pick(row(owed({ 'natel|noun': 'missing' }, 'cache full'))),
    ['full', 'No audio yet — the audio cache is full at 200 MB; raise the cap in Settings.', null, '', true]);
  assert.equal(row(owed({ 'natel|noun': 'missing' }, 'cache full'), { capMb: null })?.text,
    'No audio yet — the audio cache is full; raise the cap in Settings.',
    'a cap that could not be read is left out, not printed as 0');
  assert.deepEqual(pick(row(owed({ 'natel|noun': 'missing' }, 'no voice'),
    { voice: { phase: 'loading', text: 'preparing the voice, 41 of 380 MB', progress: 0.1 } })),
  ['loading', 'Preparing the voice…', null, '', false], 'the download started elsewhere');
  assert.deepEqual(pick(row({ ...idle, failed: [natel.k] })),
    ['failed', 'The voice could not make this word.', 'try', 'Try again', true]);
  assert.equal(row(owed({ 'bus|noun': 'missing' })), null, 'another word’s debt is not this row’s');
});

test('the list’s panel stays out of the way for one word, and comes forward for a run or a failure', () => {
  const list = (backlog: BacklogState, over: Partial<PanelInput> = {}) =>
    voicePanel({ ...base, backlog, ...over });
  assert.equal(list(owed({ 'natel|noun': 'missing' }, 'on demand')), null, 'the row says it');
  assert.deepEqual(pick(list(owed({ 'natel|noun': 'missing', 'bus|noun': 'missing' }, 'on demand'))),
    ['held', '2 words without audio', 'make', 'Make audio', false]);
  assert.deepEqual(pick(list(owed({ 'natel|noun': 'stale', 'bus|noun': 'stale' }, 'on demand'))),
    ['held', '2 words with out-of-date audio', 'make', 'Make it again', true]);
  const run = list({ ...idle, running: true, done: 2, total: 9, pending: { 'natel|noun': 'missing' },
    current: { key: natel.k, text: 'le natel' } });
  assert.deepEqual([run?.kind, run?.text, run?.emphasis, run?.count, run?.action, run?.spinner],
    ['run', 'Making audio', 'le natel', '3 of 9', null, true], 'the setting’s run: nothing to call off');
  const pressed = list({ ...idle, running: true, manual: true, done: 0, total: 1, pending: {},
    current: { key: natel.k, text: 'le natel' } });
  assert.deepEqual([pressed?.count, pressed?.action, pressed?.actionLabel], ['', 'cancel-run', 'Cancel']);
  assert.deepEqual(pick(list(owed({ 'natel|noun': 'missing', 'bus|noun': 'missing' }, 'cache full'))),
    ['full', '2 words are waiting: the audio cache is full at 200 MB. Raise the cap in Settings, or let a card ask for each.',
      null, '', true]);
  assert.deepEqual(pick(list({ ...idle, failed: [natel.k, k('bus|noun')] })),
    ['failed', '2 could not be made — see What went wrong in Settings.', 'try', 'Try again', true]);
  const both = list({ ...owed({ 'natel|noun': 'missing', 'bus|noun': 'missing' }, 'on demand'),
    failed: [k('jour|noun')] });
  assert.equal(both?.kind, 'held');
  assert.equal(both?.failed, '1 could not be made — see What went wrong in Settings.',
    'said under whatever else the panel says');
});

test('the download is watched where it was started, and nothing opens on a loading voice with nothing owed', () => {
  /* The list's panel opened, empty but for its footnote, whenever the voice
     was loading — from Settings, from a card — with nothing owed. */
  const loading = { phase: 'loading' as const, text: 'preparing the voice, 41 of 380 MB', progress: 0.11 };
  assert.equal(voicePanel({ ...base, voice: loading }), null);
  const here = voicePanel({ ...base, voice: loading, fetching: true });
  assert.deepEqual([here?.kind, here?.text, here?.progress, here?.action, here?.actionLabel],
    ['download', 'preparing the voice, 41 of 380 MB…', 0.11, 'cancel-download', 'Cancel']);
  assert.equal(voicePanel({ ...base, asking: true })?.kind, 'ask');
  assert.equal(voicePanel({ ...base, word: natel, summary: false, asking: true })?.kind, 'ask');
});

const pick = (p: ReturnType<typeof voicePanel>): unknown[] =>
  [p?.kind, p?.text, p?.action, p?.actionLabel, p?.warn];
