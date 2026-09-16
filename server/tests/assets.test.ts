/** Which paths the app's own HTML is allowed to answer for.
 *
 *  The one that mattered: /media/frcog-5293.mp3, a recording the catalogue
 *  had been rebuilt without. It came back 200 with the app in it, the audio
 *  element could not decode HTML, and nothing on screen said a word.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ISOLATION, isPagePath } from '../src/assets.js';
import { harness } from './env.js';

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

/* The voice's WebAssembly may use more than one thread only on a page that
   is cross-origin isolated, and production never was: the worker asked for
   `crossOriginIsolated`, got false, and ran on one core of the four (#54).
   Both ways a page reaches the browser must carry the headers — the file
   the asset store has, and the route the Worker answers with index.html. */
test('the app is served cross-origin isolated, so the voice may use every core', async () => {
  const h = harness();
  for (const path of ['/index.html', '/study/']) {
    const res = await h.fetch(path);
    assert.equal(res.status, 200, path);
    for (const [name, value] of Object.entries(ISOLATION)) {
      assert.equal(res.headers.get(name), value, `${name} on ${path}`);
    }
  }
});

test('a file is not a document, and carries no document policy', async () => {
  const h = harness();
  const res = await h.fetch('/catalogue/index.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cross-origin-embedder-policy'), null);
  assert.equal(res.headers.get('cross-origin-opener-policy'), null);
});
