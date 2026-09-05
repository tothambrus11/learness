/** Supertonic 3 in the browser: the voice for words you add yourself.
 *
 *  A 99M-parameter model with French among its 31 languages, run through ONNX
 *  Runtime on WebGPU where the phone has it, WebAssembly where it does not.
 *  The published weights are float32 and unquantised: four files, 380 MB
 *  together, fetched once and kept in the Cache API.
 *
 *  This file is the shell — fetching, caching, progress, timing. The pipeline
 *  itself is in supertonic.js, where it can be run against the real weights
 *  outside a browser.
 */
import * as ort from 'onnxruntime-web/webgpu';
import { createSupertonic } from './supertonic.js';
import { wavBlob } from './wav.js';

const REPO = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/';
const VOICE = 'F1';                  /* one of M1-M5, F1-F5; the language is separate */
const CACHE = 'supertonic-3';

/* Sizes as published, so the first download can be counted before it starts.
   A file whose Content-Length disagrees corrects its own share as it lands. */
const ASSETS = {
  'onnx/tts.json': 8253,
  'onnx/unicode_indexer.json': 277676,
  voice_style: 292046,
  'onnx/duration_predictor.onnx': 3700147,
  'onnx/text_encoder.onnx': 36416150,
  'onnx/vector_estimator.onnx': 256534781,
  'onnx/vocoder.onnx': 101424195,
};
const url = (path) => REPO + (path === 'voice_style' ? `voice_styles/${VOICE}.json` : path);

/* Same-origin ONNX Runtime: the service worker keeps /ort/, so the voice still
   works offline. Threads need cross-origin isolation, which a plain static
   host does not give. */
ort.env.wasm.wasmPaths = new URL('/ort/', self.location.origin).href;
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const seen = { done: 0, total: Object.values(ASSETS).reduce((n, size) => n + size, 0) };

/* Four times a second, no more. A 380 MB download arrives in some six
   thousand chunks, and a message per chunk buries the page: every one of them
   re-renders the progress line, and the main thread never catches up. */
let reportedAt = 0;
function report(loaded, force = false) {
  const now = performance.now();
  if (!force && now - reportedAt < 250) return;
  reportedAt = now;
  postMessage({ type: 'progress', status: 'progress', loaded, total: seen.total,
    progress: seen.total ? (loaded / seen.total) * 100 : 0 });
}

/** Bytes for one asset, from the cache when it has been fetched before, with
 *  progress reported against the whole download while it has not. */
async function read(path) {
  const from = url(path);
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE) : null;
  const hit = cache && await cache.match(from);
  if (hit) {
    const buf = await hit.arrayBuffer();
    seen.done += buf.byteLength;
    report(seen.done, true);
    return buf;
  }
  const res = await fetch(from);
  if (!res.ok) throw new Error(`could not fetch ${path} (${res.status})`);
  /* Read first, cache after. Handing the cache a clone of a 256 MB response
     and waiting for it stalls: the browser buffers the copy until this side
     reads the original, and this side is the thing waiting. */
  const declared = Number(res.headers.get('content-length'));
  if (declared) seen.total += declared - ASSETS[path];
  const chunks = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    report(seen.done + got);
  }
  seen.done += got;
  report(seen.done, true);
  const out = new Uint8Array(got);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  if (cache) await cache.put(from, new Response(out, { headers: res.headers }));
  return out.buffer;
}

/* WebGPU where the device has it, WebAssembly where it does not; which one
   ran is reported with every clip, since it decides the timing. */
let backend = '';
let tts = null;
let loading = null;

function load() {
  if (!loading) {
    loading = (async () => {
      const started = performance.now();
      const providers = [];
      if (typeof navigator !== 'undefined' && navigator.gpu) providers.push('webgpu');
      providers.push('wasm');
      for (const provider of providers) {
        const engine = createSupertonic({ ort, read, executionProviders: [provider] });
        try {
          await engine.load();
          backend = provider;
          tts = engine;
          break;
        } catch (err) {
          if (provider === 'wasm') throw err;
          seen.done = 0;          /* the bytes are cached now; count them again */
        }
      }
      return performance.now() - started;
    })().catch((err) => { loading = null; throw err; });
  }
  return loading;
}

onmessage = async ({ data }) => {
  if (data.type === 'load') {
    try {
      const loadMs = await load();
      postMessage({ type: 'ready', loadMs, backend });
    } catch (err) {
      postMessage({ type: 'error', id: null, message: err.message || String(err) });
    }
    return;
  }
  if (data.type !== 'generate') return;
  try {
    if (!tts) { await load(); postMessage({ type: 'ready', backend }); }
    /* Timed from here, so the first word does not carry the model load. */
    const started = performance.now();
    const { samples, sampleRate } = await tts.synthesise(data.text, data.lang, data.speed || 1);
    postMessage({ type: 'done', id: data.id, blob: wavBlob(samples, sampleRate),
      genMs: performance.now() - started, audioMs: (samples.length / sampleRate) * 1000, backend });
  } catch (err) {
    postMessage({ type: 'error', id: data.id, message: err.message || String(err) });
  }
};
