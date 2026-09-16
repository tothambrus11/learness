/** One player, and what it promises the screens.
 *
 *  A cached sentence once said "Making it…" while it played (#34), because
 *  the flag was raised before anyone looked whether the clip was on the
 *  device; a missing recording once failed into the console and nowhere else
 *  (#31); and a sentence that arrived after its card was graded played over
 *  the next card. Each is a test here.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createPlayer } from '../src/lib/player.js';
import type { ClipState, PlayerDeps, PlayerStatus, Sounding } from '../src/lib/player.js';
import type { Phrase } from '../src/lib/conjspeech.js';

/** A speaker that records what it was asked to do and sounds only what the
 *  test says exists. Every wait is a promise the test releases, so the order
 *  of events is the test's to choose. */
function fakeSpeaker({ files = [], clips = {}, voice = true }: {
  files?: string[];
  clips?: Record<string, ClipState>;
  voice?: boolean;
} = {}): PlayerDeps & {
  log: string[];
  /** Let the clip being made arrive. */
  deliver: () => void;
  /** The phases the status went through, in order. */
  phases: string[];
  attach: (player: { onStatus: (fn: (s: PlayerStatus) => void) => () => void }) => void;
} {
  const log: string[] = [];
  const phases: string[] = [];
  let pending: (() => void) | null = null;
  const deps: PlayerDeps = {
    sound(src: string): Sounding {
      log.push(`sound ${src}`);
      let cut = false;
      return {
        play: async () => { await Promise.resolve(); return !cut && files.includes(src); },
        stop: () => { cut = true; log.push(`stop ${src}`); },
      };
    },
    async say(text: string, { lang }: { lang: string }): Promise<boolean> {
      log.push(`say ${lang} ${text}`);
      return voice;
    },
    hush: () => { log.push('hush'); },
    clipState: async (phrase: Phrase) => clips[phrase.slot] ?? 'none',
    clip: (phrase: Phrase) => new Promise<string | null>((resolve) => {
      log.push(`make ${phrase.slot}`);
      pending = () => resolve(`blob:${phrase.slot}`);
      if (clips[phrase.slot] === 'ready') pending();
    }),
  };
  return {
    ...deps, log, phases,
    deliver: () => { pending?.(); pending = null; },
    attach: (p) => { p.onStatus((s) => { phases.push(s.phase + (s.trouble ? '!' : '')); }); },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

test('the first source that sounds wins, and the rest are never tried', async () => {
  const speaker = fakeSpeaker({ files: ['/media/w1.mp3'] });
  const player = createPlayer(speaker);
  const heard = await player.play([{ file: '/media/w1.mp3' }, { say: 'la nation', lang: 'fr-FR' }]);
  assert.equal(heard, true);
  assert.deepEqual(speaker.log, ['hush', 'sound /media/w1.mp3']);
  assert.equal(player.status.phase, 'idle');
});

test('a recording that will not play falls through to the voice', async () => {
  /* A 404 dressed as a 200 is a file that decodes as nothing. The word still
     gets said, by the device. */
  const speaker = fakeSpeaker({ files: [] });
  const player = createPlayer(speaker);
  const heard = await player.play([
    { file: async () => '/media/gone.mp3' }, { say: 'la nation', lang: 'fr-FR' },
  ]);
  assert.equal(heard, true);
  assert.deepEqual(speaker.log, ['hush', 'sound /media/gone.mp3', 'say fr-FR la nation']);
});

test('when nothing sounds the player says so, and the next sound clears it', async () => {
  const speaker = fakeSpeaker({ files: ['/media/ok.mp3'], voice: false });
  const player = createPlayer(speaker);
  const heard = await player.play([{ file: '/media/gone.mp3' }, { say: 'x', lang: 'fr-FR' }],
    { missing: 'This word’s recording is missing.' });
  assert.equal(heard, false);
  assert.equal(player.status.trouble, 'This word’s recording is missing.');
  await player.play([{ file: '/media/ok.mp3' }]);
  assert.equal(player.status.trouble, '');
  assert.equal(await player.play([{ file: () => Promise.resolve(null) }]), false,
    'a source that finds nothing is not heard');
});

test('a clip already on the device is never "being made"', async () => {
  /* #34: the sentence was cached, and the button said "Making it…" for as
     long as it played. */
  const speaker = fakeSpeaker({ files: ['blob:ex0'], clips: { ex0: 'ready' } });
  const player = createPlayer(speaker);
  speaker.attach(player);
  await player.play([{ phrase: { key: 'jour|noun', slot: 'ex0', text: 'Bonne journée.' } }]);
  assert.deepEqual(speaker.phases, ['idle', 'idle', 'playing', 'idle']);
  assert.equal(speaker.phases.includes('making'), false);
});

test('a clip that has to be made is "being made" until it arrives, then plays', async () => {
  const speaker = fakeSpeaker({ files: ['blob:ex1'], clips: { ex1: 'makeable' } });
  const player = createPlayer(speaker);
  speaker.attach(player);
  const done = player.play([{ phrase: { key: 'jour|noun', slot: 'ex1', text: 'Il fait jour.' } }]);
  await settle();
  assert.equal(player.status.phase, 'making');
  speaker.deliver();
  assert.equal(await done, true);
  assert.deepEqual(speaker.phases, ['idle', 'idle', 'making', 'playing', 'idle']);
});

test('a device that cannot make the clip goes straight to the voice, with no flicker', async () => {
  const speaker = fakeSpeaker({ clips: {} });
  const player = createPlayer(speaker);
  speaker.attach(player);
  await player.play([
    { phrase: { key: 'jour|noun', slot: 'ex0', text: 'Bonne journée.' } },
    { say: 'Bonne journée.', lang: 'fr-FR', rate: 0.9 },
  ]);
  assert.deepEqual(speaker.log, ['hush', 'say fr-FR Bonne journée.']);
  assert.equal(speaker.phases.includes('making'), false);
});

test('a play stopped while its clip is being made stays silent when the clip arrives', async () => {
  /* The card was graded and the next one dealt while the sentence was still
     being synthesised. Played then, it would say the next card's French
     before it had been asked — the answer, on a "write it" card. */
  const speaker = fakeSpeaker({ files: ['blob:ex1'], clips: { ex1: 'makeable' } });
  const player = createPlayer(speaker);
  const done = player.play([{ phrase: { key: 'jour|noun', slot: 'ex1', text: 'Il fait jour.' } }]);
  await settle();
  player.stop();
  speaker.deliver();
  assert.equal(await done, false);
  assert.equal(speaker.log.some((l) => l.startsWith('sound')), false, 'nothing sounded');
  assert.equal(player.status.phase, 'idle');
});

test('one sound at a time: a new play stops the old one', async () => {
  const speaker = fakeSpeaker({ files: ['/media/a.mp3', '/media/b.mp3'] });
  const player = createPlayer(speaker);
  const first = player.play([{ file: '/media/a.mp3' }]);
  const second = player.play([{ file: '/media/b.mp3' }]);
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
  assert.deepEqual(speaker.log, ['hush', 'sound /media/a.mp3', 'hush', 'stop /media/a.mp3',
    'sound /media/b.mp3']);
});

test('stop silences the voice too, and clears what was said about the last play', async () => {
  const speaker = fakeSpeaker({ voice: false });
  const player = createPlayer(speaker);
  await player.play([{ say: 'x', lang: 'en-GB' }], { missing: 'No English voice.' });
  assert.equal(player.status.trouble, 'No English voice.');
  player.stop();
  assert.deepEqual(player.status, { phase: 'idle', trouble: '', heardMs: null });
  assert.equal(speaker.log.filter((l) => l === 'hush').length, 2);
});

test('a source that throws is one that did not sound', async () => {
  const speaker = fakeSpeaker({ voice: true });
  const player = createPlayer({ ...speaker, clip: () => Promise.reject(new Error('worker died')),
    clipState: async () => 'makeable' });
  const heard = await player.play([
    { phrase: { key: 'k', slot: 's', text: 't' } }, { say: 't', lang: 'fr-FR' },
  ]);
  assert.equal(heard, true, 'the voice stood in');
});

test('the player says how long the sound it played ran', async () => {
  /* A reading paces its pauses by the line just heard. The audio element
     knows its own length once loaded; a sounding that does not say is timed;
     and nothing is known after a stop, or before anything has played. */
  const speaker = fakeSpeaker({ files: ['/media/a.mp3'] });
  const player = createPlayer({
    ...speaker,
    sound: (src) => ({ ...speaker.sound(src), lengthMs: () => 1234 }),
  });
  assert.equal(player.status.heardMs, null, 'nothing heard yet');
  assert.equal(await player.play([{ file: '/media/a.mp3' }]), true);
  assert.equal(player.status.heardMs, 1234, 'the clip\u2019s own length');
  player.stop();
  assert.equal(player.status.heardMs, null, 'and nothing after a stop');

  const timed = createPlayer(fakeSpeaker({ files: ['/media/a.mp3'] }));
  await timed.play([{ file: '/media/a.mp3' }]);
  assert.equal(typeof timed.status.heardMs, 'number', 'timed, when the element could not say');

  const voice = createPlayer(fakeSpeaker({ voice: true }));
  await voice.play([{ say: 'je parle', lang: 'fr-FR' }]);
  assert.equal(typeof voice.status.heardMs, 'number', 'the browser\u2019s voice is timed too');

  const silent = createPlayer(fakeSpeaker({ voice: false }));
  await silent.play([{ say: 'je parle', lang: 'fr-FR' }]);
  assert.equal(silent.status.heardMs, null, 'a play nothing sounded has no length');
});
