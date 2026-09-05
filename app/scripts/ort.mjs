#!/usr/bin/env node
/** Put the ONNX Runtime WebAssembly files where the app can serve them.
 *
 *  onnxruntime-web fetches them from a CDN by default. Served from our own
 *  origin instead, the service worker can keep them, and the on-device voice
 *  keeps working offline. The package does not export them, so they are copied
 *  rather than imported. Runs before `dev` and `build`.
 *
 *  The jsep build is the one that can use WebGPU; it falls back to plain
 *  WebAssembly on a device without it.
 */
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('onnxruntime-web')), '..', 'dist');
const out = new URL('../static/ort/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const files = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];
for (const name of files) {
  const src = join(dist, name);
  const dst = join(out, name);
  try {
    if (statSync(dst).size === statSync(src).size) continue;
  } catch { /* not there yet */ }
  copyFileSync(src, dst);
}
/* espeak-ng was Kokoro's grapheme-to-phoneme step; Supertonic reads letters. */
rmSync(join(out, 'espeak-ng.wasm'), { force: true });
