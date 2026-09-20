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
import { createVoiceQueue, lengthOf, phraseId } from '../src/lib/voicequeue.js';
import type { QueueSnapshot } from '../src/lib/voicequeue.js';
import { fakeVoice, madeClip, settle } from './fakevoice.js';
import type { Phrase } from '../src/lib/conjspeech.js';
import type { Clip } from '../src/lib/model.js';

const none = async (): Promise<Clip | null> => null;

const phrase = (key: string, slot: string, text: string): Phrase => ({ key, slot, text });

test('one phrase is made at a time, because there is one voice', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  queue.warm([phrase('a|verb', 's1', 'un'), phrase('a|verb', 's2', 'deux')]);
  await settle();
  assert.deepEqual(voice.made, ['un'], 'the second waits');
  voice.release();
  await settle();
  assert.deepEqual(voice.made, ['un', 'deux']);
});

test('someone waiting jumps the queue of things nobody asked for', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
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
  const queue = createVoiceQueue(voice);
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
  const queue = createVoiceQueue(voice);
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
  const queue = createVoiceQueue({ make: async () => clip, have: none });
  assert.equal(await queue.want(phrase('a|verb', 's1', 'un')), clip);
});

test('a voice that cannot make one says so rather than throwing', async () => {
  const queue = createVoiceQueue({ make: () => Promise.reject(new Error('no model here')), have: none });
  assert.equal(await queue.want(phrase('a|verb', 's1', 'un')), null);
  assert.equal(queue.waiting, 0, 'and the queue keeps going');
});

test('a phrase with nothing to say is never queued', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  assert.equal(await queue.want(phrase('a|verb', 's1', '')), null);
  queue.warm([phrase('', 's1', 'un'), phrase('a|verb', '', 'deux')]);
  assert.equal(queue.waiting, 0);
  assert.deepEqual(voice.made, []);
});

test('leaving the sitting forgets what has not been started', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  queue.warm([phrase('a|verb', 's1', 'un'), phrase('a|verb', 's2', 'deux')]);
  await settle();
  queue.clear();
  voice.release();
  await settle();
  assert.deepEqual(voice.made, ['un'], 'what was being made finished; the rest is gone');
});

/* ------------------------------------------------------ watching the queue -- */

test('a watcher sees each job wait, start and end, in order', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  const seen: QueueSnapshot[] = [];
  queue.onChange((s) => { seen.push(s); });
  assert.deepEqual(seen, [{ current: null, waiting: [] }], 'told at once how things stand');
  const un = phrase('a|verb', 's1', 'un');
  const deux = phrase('a|verb', 's2', 'deux');
  queue.warm([un, deux]);
  await settle();
  voice.release();                         /* "un" is made, silently */
  await settle();
  voice.release(madeClip(deux));           /* "deux" comes back a clip */
  await settle();
  assert.deepEqual(seen.slice(1), [
    { current: null, waiting: ['a|verb#s1'] },
    { current: null, waiting: ['a|verb#s1', 'a|verb#s2'] },
    { current: 'a|verb#s1', waiting: ['a|verb#s2'] },
    { current: null, waiting: ['a|verb#s2'], ended: { id: 'a|verb#s1', made: false } },
    { current: 'a|verb#s2', waiting: [] },
    { current: null, waiting: [], ended: { id: 'a|verb#s2', made: true } },
  ]);
  assert.equal(phraseId(un), 'a|verb#s1', 'the ids a watcher reads are the phrases’');
});

test('a job forgotten by clear is named as dropped and never ends; one being made ends', async () => {
  /* This is how the backlog tells the sitting leaving — put the word back —
     from the voice failing — set the word aside: by what the snapshot says,
     not by a job going missing from the list. */
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  const ended: string[] = [];
  const dropped: string[] = [];
  queue.onChange((s) => { if (s.ended) ended.push(s.ended.id); if (s.dropped) dropped.push(...s.dropped); });
  queue.warm([phrase('a|verb', 's1', 'un'), phrase('a|verb', 's2', 'deux'), phrase('a|verb', 's3', 'trois')]);
  await settle();
  queue.clear();
  voice.release();
  await settle();
  assert.deepEqual(dropped, ['a|verb#s2', 'a|verb#s3'], 'the two never started');
  assert.deepEqual(ended, ['a|verb#s1'], 'and only the one being made ended');
});

test('a phrase already being made is not queued again behind itself', async () => {
  /* The backlog fed a word the sitting was already making: a second copy
     was queued, took a turn later, found the clip in the store, and ended
     for nobody — the count on the panel drifted by one. */
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  const un = phrase('a|verb', 's1', 'un');
  queue.warm([un]);
  await settle();
  queue.warm([un]);
  assert.equal(queue.waiting, 0, 'warming it again queues nothing');
  queue.wantNext([un, phrase('a|verb', 's2', 'deux')]);
  assert.equal(queue.waiting, 1, 'nor does asking for it next: only "deux" waits');
  voice.release();
  await settle();
  voice.release();
  await settle();
  assert.deepEqual(voice.made, ['un', 'deux']);
});

test('a watcher that throws does not silence the voice', async () => {
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  queue.onChange(() => { throw new Error('a screen’s bug'); });
  queue.warm([phrase('a|verb', 's1', 'un'), phrase('a|verb', 's2', 'deux')]);
  await settle();
  voice.release();
  await settle();
  assert.deepEqual(voice.made, ['un', 'deux'], 'both made, the failure written down instead');
});

/* --------------------------------------------------- preparing a sitting -- */

/** The queue as a sitting sees it: what it was handed, and nothing made. */
function spyQueue(): { given: string[]; queue: ReturnType<typeof createVoiceQueue> } {
  const given: string[] = [];
  const queue = createVoiceQueue({ make: none, have: none });
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
    const { card, word } = await import('./make.js');
    const { given, queue } = spyQueue();
    const table = {
      lemma: 'parler', aux: 'avoir', shape: 'regular -er', compound: [], impersonal: [],
      links: [], examples: {},
      groups: [{ id: 'pres', mood: 'Indicatif', tense: 'Présent', stem: 'parl',
        irregular: false, note: '',
        rows: [{ p: 'je', s: 'parl', e: 'e', f: 'parle', alt: false, dup: false }] }],
    };
    const verb = { card: card('parler|verb'), word: word({ k: 'parler|verb', conj: table }) };
    const made = await warmSitting([verb], queue);
    assert.equal(made, 0);
    assert.deepEqual(given, []);
  });

test('a sitting is made in the order its cards come: what each flip plays, then the verb’s present tense',
  async () => {
    /* #52: the eager mode is for every card scheduled, prioritised by the
       practising order — so the first card's sentence is made before the
       tenth's forms, and a bare word of your own is made where nothing
       recorded it. */
    const { phrasesForSitting } = await import('../src/lib/voicequeue.js');
    const { card, word } = await import('./make.js');
    const table = {
      lemma: 'parler', aux: 'avoir', shape: 'regular -er', compound: [], impersonal: [],
      links: [], examples: {},
      groups: [
        { id: 'pres', mood: 'Indicatif', tense: 'Présent', stem: 'parl', irregular: false,
          note: '', rows: [{ p: 'je', s: 'parl', e: 'e', f: 'parle', alt: false, dup: false }] },
        { id: 'pqp', mood: 'Subjonctif', tense: 'Plus-que-parfait', stem: 'parl',
          irregular: false, note: '',
          rows: [{ p: 'je', s: 'parl', e: 'asse', f: 'parlasse', alt: false, dup: false }] },
      ],
    };
    const items = [
      { card: card('jour|noun', 'written', 'use'),
        word: word({ k: 'jour|noun', fr: 'le jour', audio: 'jour.mp3',
          ex: [{ fr: 'Il fait jour.', f: 'jour', en: 'It is daytime.' }] }) },
      { card: card('natel|noun', 'written', 'recognise'),
        /* Worded by clipText — one gloss of the French, not the pair — so the
           clip the sitting makes is the one the words screen then finds. */
        word: word({ k: 'natel|noun', fr: 'le natel; le portable', answer: 'le natel; le portable',
          pos: 'noun', gender: 'm', audio: null, native: null, user: true }) },
      { card: card('parler|verb', 'written', 'recognise'),
        word: word({ k: 'parler|verb', fr: 'parler', audio: 'parler.mp3', conj: table }) },
      { card: card('train|noun', 'heard', 'hear'), word: word({ k: 'train|noun', audio: 'train.mp3' }) },
    ];
    assert.deepEqual(phrasesForSitting(items).map((p) => `${p.key}#${p.slot}: ${p.text}`), [
      'jour|noun#ex0: Il fait jour.',            /* the sentence its flip plays */
      'natel|noun#word: le natel',                /* a word of yours with no recording */
      'parler|verb#conj:pres:0: je parle',        /* the present tense, not the whole table */
      /* the train has a recording and no phrase: nothing to make */
    ]);
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
    const { card, word } = await import('./make.js');
    const verb = word({ k: 'parler|verb', audio: 'parler.mp3', conj: {
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

    const item = { card: card('parler|verb'), word: verb };
    const eager = spyQueue();
    assert.equal(await warmSitting([item], eager.queue), 1);
    assert.deepEqual(eager.given, ['je parle'],
      'the present tense, not the whole table: forty clips a verb is a phone’s afternoon');

    await app.db.setSetting('eagerVoice', false);
    const lazy = spyQueue();
    assert.equal(await warmSitting([item], lazy.queue), 0);
    assert.deepEqual(lazy.given, [], 'off means nothing is made until it is pointed at');
    vi.unstubAllGlobals();
  });

test('a clip already made is handed over without waiting for the voice', async () => {
  /* Every ask used to take a turn on the voice, so a clip that was on the
     device waited behind whichever warm-up job had just started: a whole
     clip's synthesis of silence between two lines both already made (#60). */
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  const clip = { id: 'x', key: 'a|verb', kind: 'fr', engine: 'supertonic', text: 'deux',
    blob: new Blob() } as Clip;
  voice.stored.set('deux', clip);
  queue.warm([phrase('b|verb', 's1', 'un')]);
  await settle();                        /* "un" is being made, and will be for a while */
  assert.equal(await queue.want(phrase('a|verb', 's2', 'deux')), clip, 'handed over at once');
  assert.deepEqual(voice.made, ['un'], 'and never made again');
  assert.equal(queue.waiting, 0);
});

test('the lines of a tense are made ahead of the one being said, in reading order', async () => {
  /* The reading asks for its six lines before the first is said, and they go
     to the head in the order they are read — so the second line is being made
     while the first plays, and the sitting's own preparation waits (#60). */
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  queue.warm([phrase('b|verb', 's1', 'bleu'), phrase('b|verb', 's2', 'blanc')]);
  await settle();                        /* "bleu" is being made */
  const tense = [phrase('a|verb', 'conj:pres:0', 'je parle'),
    phrase('a|verb', 'conj:pres:1', 'tu parles'), phrase('a|verb', 'conj:pres:2', 'il parle')];
  queue.wantNext(tense);
  assert.equal(queue.waiting, 4);
  for (let n = 0; n < 4; n += 1) { voice.release(); await settle(); }
  assert.deepEqual(voice.made, ['bleu', 'je parle', 'tu parles', 'il parle', 'blanc'],
    'the tense in its order, then what was waiting before');
});

test('a line asked for while it is being made is not made twice', async () => {
  /* The reading reaches a line while the voice is still on it, or while it
     is still waiting its turn: the ask joins that job rather than starting
     another, and resolves when the voice is done with it. */
  const voice = fakeVoice();
  const queue = createVoiceQueue(voice);
  queue.wantNext([phrase('a|verb', 'conj:pres:0', 'je parle'),
    phrase('a|verb', 'conj:pres:1', 'tu parles')]);
  await settle();                        /* "je parle" is being made */
  let first = false;
  void queue.want(phrase('a|verb', 'conj:pres:0', 'je parle')).then(() => { first = true; });
  const second = queue.want(phrase('a|verb', 'conj:pres:1', 'tu parles'));
  assert.equal(queue.waiting, 1, 'neither moved, and neither multiplied');
  voice.release();
  await settle();
  assert.equal(first, true, 'the line being made resolved when the voice finished it');
  voice.release();
  await second;
  assert.deepEqual(voice.made, ['je parle', 'tu parles']);
});

test('how long a line runs is what the voice made of it, and unknown where it made nothing', async () => {
  const clip = { id: 'x', key: 'a|verb', kind: 'fr', engine: 'supertonic', text: 'je parle',
    blob: new Blob(), audioMs: 1300 } as Clip;
  const voice = fakeVoice();
  voice.stored.set('je parle', clip);
  const queue = createVoiceQueue(voice);
  assert.equal(await lengthOf(phrase('a|verb', 'conj:pres:0', 'je parle'), queue), 1300);
  const mute = createVoiceQueue({ make: none, have: none });
  assert.equal(await lengthOf(phrase('a|verb', 'conj:pres:1', 'tu parles'), mute), null,
    'the browser will say it, for who knows how long');
  const { audioMs: _length, ...silent } = clip;
  const unmeasured = createVoiceQueue({ make: async () => silent, have: none });
  assert.equal(await lengthOf(phrase('a|verb', 'conj:pres:0', 'je parle'), unmeasured), null,
    'a clip from before the voice wrote its length down');
});
