import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CUE_SLOT, WORD_SLOT, clipKeyOf, clipStateOf, clipText, ENGINE, MODEL_MB, sentenceSlot } from '../src/lib/tts.js';
import { wavBlob } from '../src/lib/tts/wav.js';
import { createSupertonic } from '../src/lib/tts/supertonic.js';
import type { OrtLike } from '../src/lib/tts/supertonic.js';
import { userWord, word } from './make.js';

test('what the voice says is the card, article and all', () => {
  const natel = userWord({ fr: 'natel', pos: 'noun', gender: 'm', en: ['mobile phone'] });
  assert.equal(clipText(natel, 'fr'), 'le natel');
  assert.equal(clipText(natel, 'en'), 'mobile phone');
  assert.equal(clipText(word({ fr: 'le bus', en: ['bus; coach'] }), 'en'), 'bus',
    'one gloss, not a list read aloud');
  assert.equal(clipText(null, 'fr'), '');
});

test('a waveform becomes a file a browser will play', async () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const blob = wavBlob(samples, 16000);
  assert.equal(blob.type, 'audio/wav');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');
  assert.equal(bytes.length, 44 + samples.length * 2, '16-bit PCM after a 44-byte header');
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(24, true), 16000, 'the sample rate it was made at');
  assert.equal(view.getInt16(44 + 6, true), 32767, 'and full scale is not wrapped round');
});

/* The pipeline needs no weights to normalise: the text goes in wrapped in a
   language tag, and what it does to the letters decides what the model hears. */
const pipeline = createSupertonic({
  ort: {} as OrtLike,
  read: () => Promise.reject(new Error('no weights in a test')),
});

test('text is normalised the way the model was trained to hear it', () => {
  assert.equal(pipeline.normalise('le natel', 'fr'), '<fr>le natel.</fr>',
    'a bare word gets the full stop the reference adds');
  /* The reference normaliser decomposes first, so an accent comes back as its
     own code point; the model was trained on exactly that. */
  assert.equal(pipeline.normalise('Ça va ?', 'fr'), '<fr>Ça va?</fr>'.normalize('NFKD'));
  assert.equal(pipeline.normalise('a — b', 'en'), '<en>a - b.</en>');
  assert.equal(pipeline.normalise('hi 👋', 'en'), '<en>hi.</en>', 'emoji say nothing aloud');
});

test('the voice names its size and itself, for the screen that asks about it', () => {
  assert.equal(ENGINE, 'supertonic');
  assert.ok(MODEL_MB > 300, 'the number in the sentence that asks permission');
});

test('Make audio makes the French, and only the French', async () => {
  /* #51: it made the English cue too, and on an English-facing card that is
     what the learner watched it make. The cue is said on demand instead. */
  const { freshApp } = await import('./harness.js');
  const app = await freshApp();
  const { clipsState } = await import('../src/lib/tts.js');
  const { clip } = await import('./make.js');
  const natel = userWord({ fr: 'natel', pos: 'noun', gender: 'm', en: ['mobile phone'] });
  assert.equal(await clipsState(natel), 'missing');
  await app.db.putClip(clip({ id: 'natel|noun|en|supertonic', key: 'natel|noun', kind: 'en',
    text: 'mobile phone' }));
  assert.equal(await clipsState(natel), 'missing', 'an English clip alone is not the word’s audio');
  await app.db.putClip(clip({ id: 'natel|noun|fr|supertonic', key: 'natel|noun', kind: 'fr',
    text: 'le natel' }));
  assert.equal(await clipsState(natel), 'ready', 'the French is all that is owed');
  assert.equal(await clipsState({ ...natel, en: ['cell phone'] }), 'ready',
    'a cue clip left over from before is never "out of date": it is not counted');
  assert.equal(await clipsState({ ...natel, fr: 'le portable' }), 'stale');
});

test('where a word stands with its audio is one rule, over the clips it has', () => {
  /* The words screen, the card and the background backlog each ask; a screen
     with a rule of its own is how a row and its card came to disagree. */
  const natel = userWord({ fr: 'natel', pos: 'noun', gender: 'm', en: ['mobile phone'] });
  const fr = { key: 'natel|noun', kind: 'fr' as const, engine: ENGINE, text: 'le natel' };
  assert.equal(clipStateOf(natel, []), 'missing');
  assert.equal(clipStateOf(natel, [{ ...fr, kind: 'en', text: 'mobile phone' }]), 'missing',
    'an English clip alone is not the word’s audio');
  assert.equal(clipStateOf(natel, [fr]), 'ready');
  assert.equal(clipStateOf(natel, [{ ...fr, text: 'le portable' }]), 'stale',
    'a clip of the old spelling');
  assert.equal(clipStateOf({ ...natel, fr: '' }, [fr]), 'none', 'nothing to say yet');
  assert.equal(clipStateOf(natel, [{ ...fr, key: 'portable|noun' }]), 'missing',
    'another word’s clip does not count');
  assert.equal(clipStateOf(natel, [{ ...fr, engine: 'kokoro' }]), 'missing',
    'nor another voice’s');
});

test('the word and its cue are kept under the word’s own clip; everything else under its slot', () => {
  /* A play that makes the word on the way — a recording gone, a word of your
     own not yet reached — must leave the same clip Make audio would, so the
     card and the words screen agree the word now has audio. */
  assert.equal(clipKeyOf('natel|noun', WORD_SLOT), 'natel|noun');
  assert.equal(clipKeyOf('natel|noun', CUE_SLOT), 'natel|noun');
  assert.equal(clipKeyOf('natel|noun', sentenceSlot(0)), 'natel|noun#ex0');
  assert.equal(clipKeyOf('parler|verb', 'conj:pres:0'), 'parler|verb#conj:pres:0');
});
