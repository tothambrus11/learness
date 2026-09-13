/** Whose turn the one voice takes.
 *
 *  The queue exists because the on-device voice is a single worker and two
 *  kinds of caller share it: a person pointing at a verb form, and the
 *  sitting's own preparation. The preparation is always first in the door, so
 *  without an order of wanting the person waits behind thirty clips nobody
 *  asked for.
 */
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createVoiceQueue } from '../src/lib/voicequeue.js';
import type { Phrase } from '../src/lib/conjspeech.js';
import type { Clip } from '../src/lib/model.js';

/** A voice that makes nothing but says what it was asked for, one at a time,
 *  and only when the test lets it. */
function fakeVoice(): {
  made: string[];
  /** Let the phrase being made finish. */
  release: () => void;
  make: (phrase: Phrase) => Promise<Clip | null>;
} {
  const made: string[] = [];
  let free: (() => void) | null = null;
  return {
    made,
    release(): void { free?.(); free = null; },
    make(phrase: Phrase): Promise<Clip | null> {
      made.push(phrase.text);
      return new Promise<Clip | null>((resolve) => {
        free = (): void => resolve(null);
      });
    },
  };
}

const phrase = (key: string, slot: string, text: string): Phrase => ({ key, slot, text });
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

test('one phrase is made at a time, because there is one voice', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice.make);
  queue.warm([phrase('a|verb', 's1', 'un'), phrase('a|verb', 's2', 'deux')]);
  await settle();
  assert.deepEqual(voice.made, ['un'], 'the second waits');
  voice.release();
  await settle();
  assert.deepEqual(voice.made, ['un', 'deux']);
});

test('someone waiting jumps the queue of things nobody asked for', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice.make);
  queue.warm([phrase('a|verb', 's1', 'un'), phrase('a|verb', 's2', 'deux'),
    phrase('a|verb', 's3', 'trois')]);
  await settle();
  void queue.want(phrase('b|verb', 'now', 'maintenant'));
  voice.release();                       /* "un" was already being made */
  await settle();
  assert.deepEqual(voice.made, ['un', 'maintenant'],
    'the hovered form is next, not fourth');
});

test('a phrase already queued is moved up rather than made twice', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice.make);
  queue.warm([phrase('a|verb', 's1', 'un'), phrase('a|verb', 's2', 'deux'),
    phrase('a|verb', 's3', 'trois')]);
  await settle();
  void queue.want(phrase('a|verb', 's3', 'trois'));
  assert.equal(queue.waiting, 2, 'still two waiting: it moved, it did not multiply');
  voice.release();
  await settle();
  assert.deepEqual(voice.made, ['un', 'trois']);
});

test('the word on screen goes to the front of what is left', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice.make);
  queue.warm([phrase('a|verb', 's1', 'un'), phrase('a|verb', 's2', 'deux'),
    phrase('b|verb', 's1', 'bleu'), phrase('b|verb', 's2', 'blanc')]);
  await settle();
  queue.prefer('b|verb');
  voice.release();
  await settle();
  assert.deepEqual(voice.made, ['un', 'bleu']);
});

test('asking for a phrase hands back what the voice made of it', async () => {
  const clip = { id: 'x', key: 'a|verb', kind: 'fr', engine: 'supertonic', text: 'un',
    blob: new Blob() } as Clip;
  const queue = createVoiceQueue(async () => clip);
  assert.equal(await queue.want(phrase('a|verb', 's1', 'un')), clip);
});

test('a voice that cannot make one says so rather than throwing', async () => {
  const queue = createVoiceQueue(() => Promise.reject(new Error('no model here')));
  assert.equal(await queue.want(phrase('a|verb', 's1', 'un')), null);
  assert.equal(queue.waiting, 0, 'and the queue keeps going');
});

test('a phrase with nothing to say is never queued', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice.make);
  assert.equal(await queue.want(phrase('a|verb', 's1', '')), null);
  queue.warm([phrase('', 's1', 'un'), phrase('a|verb', '', 'deux')]);
  assert.equal(queue.waiting, 0);
  assert.deepEqual(voice.made, []);
});

test('leaving the sitting forgets what has not been started', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice.make);
  queue.warm([phrase('a|verb', 's1', 'un'), phrase('a|verb', 's2', 'deux')]);
  await settle();
  queue.clear();
  voice.release();
  await settle();
  assert.deepEqual(voice.made, ['un'], 'what was being made finished; the rest is gone');
});

/* --------------------------------------------------- preparing a sitting -- */

/** The queue as a sitting sees it: what it was handed, and nothing made. */
function spyQueue(): { given: string[]; queue: ReturnType<typeof createVoiceQueue> } {
  const given: string[] = [];
  const queue = createVoiceQueue(async () => null);
  const warm = queue.warm;
  return {
    given,
    queue: { ...queue, warm: (phrases): void => {
      given.push(...phrases.map((p) => p.text));
      warm([]);
    } },
  };
}

test('a sitting prepares the present tense of its verbs, and nothing where the voice is absent',
  async () => {
    /* Node has no Worker, so this device cannot make a clip at all: preparing
       must not queue work that would sit there for ever, and must never be
       what starts the 380 MB download. */
    const { warmSitting } = await import('../src/lib/voicequeue.js');
    const { word } = await import('./make.js');
    const { given, queue } = spyQueue();
    const table = {
      lemma: 'parler', aux: 'avoir', shape: 'regular -er', compound: [], impersonal: [],
      links: [], examples: {},
      groups: [{ id: 'pres', mood: 'Indicatif', tense: 'Présent', stem: 'parl',
        irregular: false, note: '',
        rows: [{ p: 'je', s: 'parl', e: 'e', f: 'parle', alt: false, dup: false }] }],
    };
    const made = await warmSitting([word({ k: 'parler|verb', conj: table })], queue);
    assert.equal(made, 0);
    assert.deepEqual(given, []);
  });

test('a sitting prepares its verbs where the voice is here, unless you said not to',
  async () => {
    const { freshApp } = await import('./harness.js');
    const app = await freshApp();
    /* A device that can run a worker, with the model already fetched: the only
       state in which anything is made before it is asked for. */
    vi.stubGlobal('Worker', function FakeWorker(): void {});
    await app.db.setSetting('supertonicReady', true);
    const { warmSitting } = await import('../src/lib/voicequeue.js');
    const { word } = await import('./make.js');
    const verb = word({ k: 'parler|verb', conj: {
      lemma: 'parler', aux: 'avoir', shape: 'regular -er', compound: [], impersonal: [],
      links: [], examples: {},
      groups: [
        { id: 'pres', mood: 'Indicatif', tense: 'Présent', stem: 'parl', irregular: false,
          note: '', rows: [{ p: 'je', s: 'parl', e: 'e', f: 'parle', alt: false, dup: false }] },
        { id: 'pqp', mood: 'Subjonctif', tense: 'Plus-que-parfait', stem: 'parl',
          irregular: false, note: '',
          rows: [{ p: 'je', s: 'parl', e: 'asse', f: 'parlasse', alt: false, dup: false }] },
      ],
    } });

    const eager = spyQueue();
    assert.equal(await warmSitting([verb], eager.queue), 1);
    assert.deepEqual(eager.given, ['je parle'],
      'the present tense, not the whole table: forty clips a verb is a phone’s afternoon');

    await app.db.setSetting('eagerVoice', false);
    const lazy = spyQueue();
    assert.equal(await warmSitting([verb], lazy.queue), 0);
    assert.deepEqual(lazy.given, [], 'off means nothing is made until it is pointed at');
    vi.unstubAllGlobals();
  });
