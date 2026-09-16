/** Which voice says a thing, as the table it is.
 *
 *  #44: the example sentences on a card were read by the browser's voice
 *  while the on-device one — a 380 MB download the learner had agreed to —
 *  sat beside it unused. Two screens routed two kinds of text to two voices,
 *  and nothing decided between them. This is the decision, once.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { engineFor, langOf, NO_SPEAKERS } from '../src/lib/engine.js';
import type { SpeechKind } from '../src/lib/engine.js';

const KINDS: readonly SpeechKind[] = ['word', 'cue', 'sentence', 'form'];

test('once the voice is on the device, everything is said by it', () => {
  const here = { model: true, browser: { fr: true, en: true } };
  for (const kind of KINDS) {
    assert.equal(engineFor(here, kind), 'supertonic', `${kind}: the good voice, not the free one`);
  }
  /* Even on a device whose browser has no voice at all: the model speaks both
     languages on its own. */
  for (const kind of KINDS) {
    assert.equal(engineFor({ model: true, browser: { fr: false, en: false } }, kind), 'supertonic');
  }
});

test('until then the browser’s voice says what it can, in the language each thing is in', () => {
  const both = { model: false, browser: { fr: true, en: true } };
  for (const kind of KINDS) assert.equal(engineFor(both, kind), 'browser');
  /* A phone with an English voice and no French one is common: the cue is
     read, and the French is not mispronounced in an English voice. */
  const englishOnly = { model: false, browser: { fr: false, en: true } };
  assert.equal(engineFor(englishOnly, 'cue'), 'browser');
  assert.equal(engineFor(englishOnly, 'word'), 'none');
  assert.equal(engineFor(englishOnly, 'sentence'), 'none');
  assert.equal(engineFor(englishOnly, 'form'), 'none');
  const frenchOnly = { model: false, browser: { fr: true, en: false } };
  assert.equal(engineFor(frenchOnly, 'cue'), 'none');
  assert.equal(engineFor(frenchOnly, 'sentence'), 'browser');
});

test('a device with neither says so', () => {
  for (const kind of KINDS) assert.equal(engineFor(NO_SPEAKERS, kind), 'none');
});

test('the cue is the one thing said in English', () => {
  assert.deepEqual(KINDS.map(langOf), ['fr', 'en', 'fr', 'fr']);
});
