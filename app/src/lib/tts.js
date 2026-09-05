/** Making audio on the device for your own words.
 *
 *  Supertonic 3, and only Supertonic. Kokoro was here first and made both
 *  clips beside it for a while, which is how it was measured out: its one
 *  French voice, trained on under eleven hours of speech, was the weaker of
 *  the two to listen to and the slower of the two to run — some 3.5 seconds a
 *  word against 1.8 on the same machine. Two models to download and keep was
 *  not worth it for the loser.
 *
 *  The worker holds the model; this side queues requests, stores the clips in
 *  IndexedDB and reports progress, so a screen can say "preparing the voice,
 *  41 of 380 MB" the first time and "making audio for le natel" after that.
 *  Each clip records how long it took to make, which is what the words screen
 *  adds up.
 */
import { clipId, clipsFor, getClip, getSettings, putClip, setSetting } from './db.js';
import { isOnline } from './network.js';

const KINDS = ['fr', 'en'];

/** The voice. The clip ids carry its name, so a second one could be put
 *  beside it again without moving what is already stored. */
export const ENGINE = 'supertonic';
export const ENGINE_LABEL = 'Supertonic';
/** The one-time download: four ONNX models as published, float32 and
 *  unquantised. */
export const MODEL_MB = 380;

export const canGenerate = () =>
  typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';

let worker = null;
let ready = null;
let settle = null;
let seq = 0;
const pending = new Map();
const listeners = new Set();
let status = { phase: 'idle', text: '', progress: 0 };  /* idle | loading | ready | busy | error */

function emit(next) {
  status = { ...status, ...next };
  for (const fn of listeners) fn(status);
}

export function onStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./tts/supertonic.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      if (data.status === 'progress' && data.total) {
        const mb = (n) => (n / 1048576).toFixed(0);
        emit({ phase: 'loading', text: `preparing the voice, ${mb(data.loaded)} of ${mb(data.total)} MB`,
          progress: data.progress / 100 });
      }
      return;
    }
    if (data.type === 'ready') {
      setSetting(`${ENGINE}Ready`, true).catch(() => {});
      if (data.loadMs) setSetting(`${ENGINE}LoadMs`, Math.round(data.loadMs)).catch(() => {});
      if (data.backend) setSetting(`${ENGINE}Backend`, data.backend).catch(() => {});
      settle?.resolve();
      if (status.phase === 'loading') emit({ phase: 'ready', text: '', progress: 1 });
      return;
    }
    const job = pending.get(data.id);
    if (!job) {
      if (data.type === 'error') {
        settle?.reject(new Error(data.message));
        ready = null;
        emit({ phase: 'error', text: data.message });
      }
      return;
    }
    pending.delete(data.id);
    if (data.type === 'done') job.resolve(data);
    else job.reject(new Error(data.message));
    if (!pending.size) emit({ phase: 'ready', text: '', progress: 1 });
  };
  worker.onerror = (err) => emit({ phase: 'error', text: err.message || 'the voice worker failed' });
  return worker;
}

/** Has this device already fetched the model? Then nothing needs asking. */
export async function modelCached() {
  return !!(await getSettings())[`${ENGINE}Ready`];
}

/** Fetch and start the voice. Resolves when it can speak, so the first word
 *  is not timed with the model load inside it. */
export function warmUp() {
  const w = ensureWorker();
  if (!ready) {
    emit({ phase: 'loading', text: 'preparing the voice', progress: 0 });
    ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    ready.catch(() => {});          /* a caller that only starts it is not a failure */
    w.postMessage({ type: 'load' });
  }
  return ready;
}

export async function synthesise(text, lang, { speed = 1 } = {}) {
  const w = ensureWorker();
  await warmUp();
  const id = ++seq;
  emit({ phase: 'busy', text: `making audio for “${text}”` });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: 'generate', id, text, lang, speed });
  });
}

/** Clips a word still lacks. */
export async function missingClips(key) {
  const have = new Set((await clipsFor(key)).filter((c) => c.engine === ENGINE).map((c) => c.kind));
  return KINDS.filter((kind) => !have.has(kind));
}

/** How many clips a word wants in all: the French prompt and the English cue. */
export const CLIPS_PER_WORD = KINDS.length;

const cueFor = (rec, kind) => {
  const text = kind === 'fr' ? rec.fr : (Array.isArray(rec.en) ? rec.en[0] : rec.en) || '';
  return text.split(';')[0].trim();
};

/** Make and store the clips one of your words is missing, each with the time
 *  it took, so a device that struggles says so. */
export async function ensureClips(rec) {
  const made = [];
  for (const kind of await missingClips(rec.k)) {
    const cue = cueFor(rec, kind);
    if (!cue) continue;
    const { blob, genMs, audioMs, backend } = await synthesise(cue, kind);
    await putClip({ id: clipId(rec.k, kind, ENGINE), key: rec.k, kind, engine: ENGINE, text: cue,
      blob, genMs, audioMs, backend, createdAt: Date.now() });
    made.push({ kind, genMs, audioMs });
  }
  return made;
}

/** May we start now without asking? Offline with no model is a plain no. */
export async function generationState() {
  if (!canGenerate()) return 'unsupported';
  if (await modelCached()) return 'ready';
  return isOnline() ? 'needs-download' : 'offline';
}

/** What the voice cost on this device: the one-time load, and which backend
 *  ran it. The per-word time lives on the clips themselves. */
export async function loadTimes() {
  const settings = await getSettings();
  return { [ENGINE]: { loadMs: settings[`${ENGINE}LoadMs`] ?? null,
    backend: settings[`${ENGINE}Backend`] ?? null } };
}

export { getClip };
