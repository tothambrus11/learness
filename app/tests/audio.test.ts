import { test } from 'vitest';
import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { freshApp } from './harness.js';
import { clip, word } from './make.js';

/** Object URLs do not exist in Node; what matters here is which blob was
 *  handed out, so each one is given a name of its own. */
function stubObjectUrls(): { urlOf: Map<string, Blob>; revoked: string[] } {
  const urlOf = new Map<string, Blob>();
  const revoked: string[] = [];
  let n = 0;
  /* The two statics only, onto the real URL: replacing the class itself breaks
     every other use of it, which in this app is most of the fetching. */
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource): string => {
    const url = `blob:${++n}`;
    urlOf.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string): void => { revoked.push(url); });
  return { urlOf, revoked };
}

test('a catalogue word plays the file the pipeline shipped', async () => {
  await freshApp();
  const { srcFor } = await import('../src/lib/audio.js');
  const w = word({ audio: 'frcog-1.mp3', native: 'frcog-1-nat.mp3', cue_audio: 'frcog-1-en.mp3' });
  assert.equal(await srcFor(w, 'fr'), '/media/frcog-1.mp3');
  assert.equal(await srcFor(w, 'native'), '/media/frcog-1-nat.mp3');
  assert.equal(await srcFor(w, 'en'), '/media/frcog-1-en.mp3');
});

test('a word with no recording of its own falls back to the one it has', async () => {
  await freshApp();
  const { srcFor } = await import('../src/lib/audio.js');
  const onlyNative = word({ audio: null, native: 'nat.mp3' });
  assert.equal(await srcFor(onlyNative, 'fr'), '/media/nat.mp3');
  assert.equal(await srcFor(word({ audio: null, native: null }), 'fr'), null,
    'and nothing where there is nothing');
});

test('one of your own words plays the clip made on this device', async () => {
  const app = await freshApp();
  stubObjectUrls();
  const { srcFor } = await import('../src/lib/audio.js');
  const mine = word({ k: 'natel|noun', fr: 'le natel', answer: 'le natel', pos: 'noun',
    gender: 'm', audio: null, native: null, user: true, en: ['mobile phone'] });
  await app.db.putClip(clip({ id: 'natel|noun|fr|supertonic', key: 'natel|noun', kind: 'fr',
    text: 'le natel' }));

  const src = await srcFor(mine, 'fr');
  assert.match(String(src), /^blob:/);
  assert.equal(await srcFor(mine, 'fr'), src, 'made once, then handed out again');
});

test('a clip that no longer says what the word says is not played', async () => {
  const app = await freshApp();
  stubObjectUrls();
  const { srcFor } = await import('../src/lib/audio.js');
  const mine = word({ k: 'natel|noun', fr: "l'erreur", answer: "l'erreur", pos: 'noun',
    gender: 'f', audio: null, native: null, user: true, en: ['mistake'] });
  await app.db.putClip(clip({ id: 'natel|noun|fr|supertonic', key: 'natel|noun', kind: 'fr',
    text: 'le natel' }));
  assert.equal(await srcFor(mine, 'fr'), null,
    'it says the old spelling, and teaching that back is worse than silence');
});
