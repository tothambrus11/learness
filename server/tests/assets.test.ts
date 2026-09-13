/** Which paths the app's own HTML is allowed to answer for.
 *
 *  The one that mattered: /media/frcog-5293.mp3, a recording the catalogue
 *  had been rebuilt without. It came back 200 with the app in it, the audio
 *  element could not decode HTML, and nothing on screen said a word.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isPagePath } from '../src/assets.js';

test('a route with no file in it is a page, and gets the app', () => {
  for (const path of ['/', '/study/', '/words', '/progress/', '/connect/passkey']) {
    assert.equal(isPagePath(path), true, path);
  }
});

test('a missing recording is missing, not the app in disguise', () => {
  assert.equal(isPagePath('/media/frcog-5293.mp3'), false);
  assert.equal(isPagePath('/media/anything'), false, 'whatever the name inside /media');
});

test('the catalogue, the code and the voice runtime are files too', () => {
  assert.equal(isPagePath('/catalogue/level-01.json'), false);
  assert.equal(isPagePath('/_app/immutable/entry/start.js'), false);
  assert.equal(isPagePath('/ort/ort-wasm-simd-threaded.jsep.wasm'), false);
});

test('anything with an extension is a file wherever it lives', () => {
  assert.equal(isPagePath('/favicon.ico'), false);
  assert.equal(isPagePath('/manifest.webmanifest'), false);
  assert.equal(isPagePath('/index.html'), false);
});
