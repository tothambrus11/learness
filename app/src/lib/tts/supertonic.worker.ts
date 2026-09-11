/** Supertonic 3 in the browser: the voice for words you add yourself. The shell
 *  around the pipeline — fetching, caching, progress, timing. */

import * as ort from 'onnxruntime-web/webgpu';

import { VOICE_CACHE } from './cache';
import type { TtsReply, TtsRequest } from './protocol';
import type { Supertonic } from './supertonic';
import { createSupertonic } from './supertonic';
import { wavBlob } from './wav';

/* A worker's `self` is not the window global the DOM library assumes, and a
   bare `postMessage` would mean the window's, which takes a target origin. */
/** This worker's own global: it reads its own location and knows whether it is
 *  cross-origin isolated. */
declare const self: DedicatedWorkerGlobalScope;
/** The worker's own `postMessage`, carrying only the protocol's replies. */
declare function postMessage(reply: TtsReply): void;

/** Where the weights are published. */
const REPO = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/';
/** Which of the published voices is fetched: one of M1-M5 or F1-F5, the
 *  language being separate. One per deck: the clips already made are not
 *  remade, so changing it would leave two voices side by side. */
const VOICE = 'F1';
/** The Cache API bucket the fetched files are kept in, named in one place. */
const CACHE = VOICE_CACHE;

/** Sizes as published, so the first download can be counted before it starts.
 *  A file whose Content-Length disagrees corrects its own share as it lands. */
const ASSETS: Record<string, number> = {
  'onnx/tts.json': 8253,
  'onnx/unicode_indexer.json': 277676,
  voice_style: 292046,
  'onnx/duration_predictor.onnx': 3700147,
  'onnx/text_encoder.onnx': 36416150,
  'onnx/vector_estimator.onnx': 256534781,
  'onnx/vocoder.onnx': 101424195,
};
/** Where one asset lives. The voice is the odd one out: it is a file per
 *  voice, under a directory of its own. */
const url = (path: string): string =>
  REPO + (path === 'voice_style' ? `voice_styles/${VOICE}.json` : path);

/** What went wrong, in the words the page shows: an Error's own message where
 *  it has one, and whatever was thrown otherwise. */
const reason = (err: unknown): string => (err instanceof Error && err.message) || String(err);

/* Same-origin ONNX Runtime: the service worker keeps /ort/, so the voice still
   works offline. Threads need cross-origin isolation, which a plain static
   host does not give. */
ort.env.wasm.wasmPaths = new URL('/ort/', self.location.origin).href;
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1)
  : 1;

/** How much of the download has landed, against how much is expected. Both
 *  grow: `total` is corrected as each file's real length arrives. */
const seen = { done: 0, total: Object.values(ASSETS).reduce((n, size) => n + size, 0) };

/** The shortest gap between progress messages. A 380 MB download arrives in
 *  some six thousand chunks, and a message per chunk buries the main thread:
 *  every one of them re-renders the progress line. */
const REPORT_EVERY_MS = 250;

/** When the last progress message went out, in worker time. */
let reportedAt = 0;
/** Tells the page how far the download has got. `force` is for the end of a
 *  file, which must be reported even inside the `REPORT_EVERY_MS` window. */
function report(loaded: number, force = false): void {
  const now = performance.now();
  if (!force && now - reportedAt < REPORT_EVERY_MS) return;
  reportedAt = now;
  postMessage({
    type: 'progress',
    status: 'progress',
    loaded,
    total: seen.total,
    progress: seen.total ? (loaded / seen.total) * 100 : 0,
  });
}

/** Bytes for one asset, from the cache when it has been fetched before, with
 *  progress reported against the whole download while it has not. */
async function read(path: string): Promise<ArrayBuffer> {
  const from = url(path);
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE) : null;
  const hit = cache && (await cache.match(from));
  if (hit) {
    const buf = await hit.arrayBuffer();
    seen.done += buf.byteLength;
    report(seen.done, true);
    return buf;
  }
  const res = await fetch(from);
  if (!res.ok) throw new Error(`could not fetch ${path} (${res.status})`);
  /* Read first, cache after: handing the cache a clone of a 256 MB response
     stalls, the browser buffering it until this side reads the original. */
  const declared = Number(res.headers.get('content-length'));
  if (declared) seen.total += declared - ASSETS[path];
  const chunks = [];
  let got = 0;
  /* `body` is typed as nullable; a fetched response always carries one. */
  if (!res.body) throw new Error(`could not read ${path} (no body)`);
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
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  if (cache) await cache.put(from, new Response(out, { headers: res.headers }));
  return out.buffer;
}

/** Which backend took the model — `webgpu` or `wasm` — `''` until one has. It
 *  is reported with every clip, since it decides the timing. */
let backend = '';
/** The pipeline once a backend has taken it, null until then. */
let tts: Supertonic | null = null;
/** The load in flight, so a second request joins the first rather than
 *  starting a second 380 MB download. Cleared on failure, so it can be tried
 *  again. Resolves with the milliseconds it took. */
let loading: Promise<number> | null = null;

/** Fetches the weights and starts the first backend that will run them —
 *  WebGPU where the device has it, WebAssembly where it does not. Resolves
 *  with how long that took, all files included. */
function load(): Promise<number> {
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
          seen.done = 0; /* the bytes are cached now; count them again */
        }
      }
      return performance.now() - started;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

onmessage = async ({ data }: MessageEvent<TtsRequest>) => {
  if (data.type === 'load') {
    try {
      const loadMs = await load();
      postMessage({ type: 'ready', loadMs, backend });
    } catch (err) {
      postMessage({ type: 'error', id: null, message: reason(err) });
    }
    return;
  }
  if (data.type !== 'generate') return;
  try {
    if (!tts) {
      await load();
      postMessage({ type: 'ready', backend });
    }
    /* `tts` is typed as nullable; load() either set it or threw. */
    const engine = tts;
    if (!engine) throw new Error('the voice did not load');
    const started = performance.now();
    const { samples, sampleRate } = await engine.synthesise(
      data.text,
      data.lang,
      data.speed || 1,
    );
    postMessage({
      type: 'done',
      id: data.id,
      blob: wavBlob(samples, sampleRate),
      genMs: performance.now() - started,
      audioMs: (samples.length / sampleRate) * 1000,
      backend,
    });
  } catch (err) {
    postMessage({ type: 'error', id: data.id, message: reason(err) });
  }
};
