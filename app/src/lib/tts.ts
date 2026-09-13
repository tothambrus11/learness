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
import { withDefiniteArticle } from './gender.js';
import type { Clip, StudyWord, UserWord } from './model.js';
import { isOnline } from './network.js';
import { VOICE_CACHE } from './tts/cache.js';
import { nowMs } from './units.js';

const KINDS = ['fr', 'en'] as const;
export type ClipKind = (typeof KINDS)[number];

/** What the worker is doing, for a screen that shows it. */
export interface VoiceStatus {
  phase: 'idle' | 'loading' | 'ready' | 'busy' | 'error';
  text: string;
  /** 0..1 through the one-time download. */
  progress: number;
}

/** What this side asks the worker for. */
type Request =
  | { type: 'load' }
  | { type: 'generate'; id: number; text: string; lang: string; speed: number };

/** What comes back. `done` carries the audio; `error` carries the reason, and
 *  the id of the request it belongs to where there is one. */
type Response =
  | { type: 'progress'; status: string; loaded: number; total: number; progress: number }
  | { type: 'ready'; loadMs?: number; backend?: string }
  | { type: 'done'; id: number; blob: Blob; genMs: number; audioMs: number; backend: string }
  | { type: 'error'; id: number | null; message: string };

/** One clip the worker has been asked for. */
interface Job {
  resolve: (made: Extract<Response, { type: 'done' }>) => void;
  reject: (err: Error) => void;
}

/** A record either side of the voice can read: your own word, or a catalogue
 *  word as a card shows it. */
type Sayable = Pick<UserWord, 'fr' | 'pos' | 'gender' | 'number'> & { en?: string[] | string };

/** The voice. The clip ids carry its name, so a second one could be put
 *  beside it again without moving what is already stored. */
export const ENGINE = 'supertonic';
export const ENGINE_LABEL = 'Supertonic';
/** The one-time download: four ONNX models as published, float32 and
 *  unquantised. */
export const MODEL_MB = 380;

const canGenerate = (): boolean =>
  typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let settle: { resolve: () => void; reject: (err: Error) => void } | null = null;
let seq = 0;
const pending = new Map<number, Job>();
const listeners = new Set<(status: VoiceStatus) => void>();
let status: VoiceStatus = { phase: 'idle', text: '', progress: 0 };

function emit(next: Partial<VoiceStatus>): void {
  status = { ...status, ...next };
  for (const fn of listeners) fn(status);
}

export function onStatus(fn: (status: VoiceStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => { listeners.delete(fn); };
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./tts/supertonic.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<Response>): void => {
    if (data.type === 'progress') {
      if (data.status === 'progress' && data.total) {
        const mb = (n: number): string => (n / 1048576).toFixed(0);
        emit({ phase: 'loading', text: `preparing the voice, ${mb(data.loaded)} of ${mb(data.total)} MB`,
          progress: data.progress / 100 });
      }
      return;
    }
    if (data.type === 'ready') {
      void setSetting(`${ENGINE}Ready`, true).catch(() => {});
      if (data.loadMs) void setSetting(`${ENGINE}LoadMs`, Math.round(data.loadMs)).catch(() => {});
      if (data.backend) void setSetting(`${ENGINE}Backend`, data.backend).catch(() => {});
      settle?.resolve();
      if (status.phase === 'loading') emit({ phase: 'ready', text: '', progress: 1 });
      return;
    }
    const job = data.id === null ? undefined : pending.get(data.id);
    if (!job) {
      /* Nothing waiting on it: an error here is the load itself failing. */
      if (data.type === 'error') {
        settle?.reject(new Error(data.message));
        ready = null;
        emit({ phase: 'error', text: data.message });
      }
      return;
    }
    if (data.id !== null) pending.delete(data.id);
    if (data.type === 'done') job.resolve(data);
    else job.reject(new Error(data.message));
    if (!pending.size) emit({ phase: 'ready', text: '', progress: 1 });
  };
  worker.onerror = (err): void => {
    emit({ phase: 'error', text: err.message || 'the voice worker failed' });
  };
  return worker;
}

/** Typed on the way out, so a message the worker does not understand is a
 *  compile error rather than a request that is silently ignored. */
const send = (w: Worker, message: Request): void => { w.postMessage(message); };

/** Has this device already fetched the model? Then nothing needs asking. */
export async function modelCached(): Promise<boolean> {
  return !!(await getSettings())[`${ENGINE}Ready`];
}

/** Give the 380 MB back. Nothing learned is lost — the clips already made stay
 *  in the database — and the next word that needs audio asks about the download
 *  again. */
export async function forgetModel(): Promise<void> {
  cancel();
  if (typeof caches !== 'undefined') await caches.delete(VOICE_CACHE);
  await setSetting(`${ENGINE}Ready`, false);
}

/** Fetch and start the voice. Resolves when it can speak, so the first word
 *  is not timed with the model load inside it. */
function warmUp(): Promise<void> {
  const w = ensureWorker();
  if (!ready) {
    emit({ phase: 'loading', text: 'preparing the voice', progress: 0 });
    ready = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
    ready.catch(() => {});          /* a caller that only starts it is not a failure */
    send(w, { type: 'load' });
  }
  return ready;
}

async function synthesise(
  text: string, lang: string, { speed = 1 }: { speed?: number } = {},
): Promise<Extract<Response, { type: 'done' }>> {
  const w = ensureWorker();
  await warmUp();
  const id = ++seq;
  emit({ phase: 'busy', text: `making audio for “${text}”` });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send(w, { type: 'generate', id, text, lang, speed });
  });
}

/** Give up on the voice: stop the download, drop the worker, forget what was
 *  queued. What has already been fetched stays in the cache — each file is kept
 *  whole, so starting again resumes at the file it stopped on rather than at
 *  zero. */
export function cancel(): void {
  if (!worker) return;
  worker.terminate();
  worker = null;
  const stopped = new Error('The voice was cancelled.');
  settle?.reject(stopped);
  settle = null;
  ready = null;
  for (const job of pending.values()) job.reject(stopped);
  pending.clear();
  emit({ phase: 'idle', text: '', progress: 0 });
}

/** The words the voice says for a record: the French as the card shows it,
 *  article and all, and the first English gloss.
 *
 *  Written down with the clip, so a clip can say whether it is still about the
 *  word it was made for. Works on a stored record and on a study word alike —
 *  adding the definite article to a form that has one changes nothing. */
export function clipText(rec: Sayable | StudyWord | null | undefined, kind: ClipKind): string {
  const text: string = kind === 'fr'
    ? withDefiniteArticle(rec?.fr ?? '', rec?.pos, rec?.gender, rec?.number)
    : (Array.isArray(rec?.en) ? rec.en[0] : rec?.en) || '';
  return text.split(';')[0]!.trim();
}

/** Clips a word still lacks. */
async function missingClips(key: string): Promise<ClipKind[]> {
  const have = new Set((await clipsFor(key)).filter((c) => c.engine === ENGINE).map((c) => c.kind));
  return KINDS.filter((kind) => !have.has(kind));
}

/** Clips that no longer say what the word says: the spelling was corrected, or
 *  the English was. They are not thrown away — a card with an out-of-date clip
 *  is better than a silent one, as long as it says so — but nothing plays them
 *  until they are made again. */
async function staleClips(rec: UserWord): Promise<ClipKind[]> {
  const clips = (await clipsFor(rec.k)).filter((c) => c.engine === ENGINE);
  return clips.filter((c) => clipText(rec, c.kind) && c.text !== clipText(rec, c.kind))
    .map((c) => c.kind);
}

/** 'ready' | 'stale' | 'missing' | 'none' — 'none' being a word with nothing to
 *  say, which is a word with no English yet. */
export async function clipsState(rec: UserWord): Promise<'ready' | 'stale' | 'missing' | 'none'> {
  const wanted = KINDS.filter((kind) => clipText(rec, kind));
  if (!wanted.length) return 'none';
  if ((await missingClips(rec.k)).some((kind) => wanted.includes(kind))) return 'missing';
  return (await staleClips(rec)).length ? 'stale' : 'ready';
}

/** The voice saying something that belongs to a word without being the word:
 *  one of its example sentences, one line of its conjugation table.
 *
 *  Kept under a key of its own — "<word key>#ex0", "<word key>#conj:pres:0" —
 *  so the two clips a word's card needs are counted and checked without these
 *  in the way. Made only when the voice is already on the device: a sentence
 *  is not worth a 380 MB download nobody asked for, and the browser's own
 *  voice is the fallback. Stored once, so the second time it is wanted it
 *  plays at once, which is what makes a form speak the instant it is hovered.
 */
export async function phraseClip(
  wordKey: string | null, slot: string, text: string,
): Promise<Clip | null> {
  const cue = (text ?? '').trim();
  if (!cue || !wordKey || !slot) return null;
  const key = `${wordKey}#${slot}`;
  const id = clipId(key, 'fr', ENGINE);
  const have = await getClip(id);
  if (have?.text === cue) return have;
  if (!canGenerate() || !(await modelCached())) return null;
  const { blob, genMs, audioMs, backend } = await synthesise(cue, 'fr');
  const clip: Clip = { id, key, kind: 'fr', engine: ENGINE, text: cue, blob, genMs, audioMs,
    backend, createdAt: nowMs() };
  await putClip(clip);
  return clip;
}

/** Is this phrase already on the device? Asked before hovering plays
 *  something, so a form that would have to be made first is not waited on in
 *  silence. */
export async function phraseOnDevice(wordKey: string | null, slot: string): Promise<boolean> {
  if (!wordKey || !slot) return false;
  return !!(await getClip(clipId(`${wordKey}#${slot}`, 'fr', ENGINE)));
}

/** The voice saying a whole example sentence: the sentence slot of the word. */
export const sentenceClip = (
  wordKey: string | null, index: number, text: string,
): Promise<Clip | null> => phraseClip(wordKey, `ex${index}`, text);

/** Make and store the clips one of your words is missing or has outgrown, each
 *  with the time it took, so a device that struggles says so. */
export async function ensureClips(
  rec: UserWord,
): Promise<{ kind: ClipKind; genMs: number; audioMs: number }[]> {
  const todo = new Set([...await missingClips(rec.k), ...await staleClips(rec)]);
  const made: { kind: ClipKind; genMs: number; audioMs: number }[] = [];
  for (const kind of KINDS) {
    if (!todo.has(kind)) continue;
    const cue = clipText(rec, kind);
    if (!cue) continue;
    const { blob, genMs, audioMs, backend } = await synthesise(cue, kind);
    await putClip({ id: clipId(rec.k, kind, ENGINE), key: rec.k, kind, engine: ENGINE, text: cue,
      blob, genMs, audioMs, backend, createdAt: nowMs() });
    made.push({ kind, genMs, audioMs });
  }
  return made;
}

/** May we start now without asking? Offline with no model is a plain no. */
export async function generationState():
  Promise<'unsupported' | 'ready' | 'needs-download' | 'offline'> {
  if (!canGenerate()) return 'unsupported';
  if (await modelCached()) return 'ready';
  return isOnline() ? 'needs-download' : 'offline';
}

/** What the voice cost on this device: the one-time load, and which backend
 *  ran it. The per-word time lives on the clips themselves. */
export async function loadTimes(): Promise<Record<string, {
  loadMs: number | null;
  backend: string | null;
}>> {
  const settings = await getSettings();
  return { [ENGINE]: { loadMs: settings[`${ENGINE}LoadMs`] ?? null,
    backend: settings[`${ENGINE}Backend`] ?? null } };
}

export { getClip };
