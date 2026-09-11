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
import { clipId, clipsFor, getClip, getSettings, putClip, setSetting } from './db';
import { withDefiniteArticle } from './gender';
import { isOnline } from './network';
import { VOICE_CACHE } from './tts/cache';
import type { DoneReply, SpeechLang, TtsReply, TtsRequest } from './tts/protocol';
import type { Clip, StudyWord, WordKey } from './types';

/** Which side of a card a clip says. The same two values a `Clip` is keyed by. */
export type ClipKind = Clip['kind'];

/** The two clips a word wants, in the order they are made. */
const KINDS = ['fr', 'en'] as const;

/** The voice. The clip ids carry its name, so a second one could be put
 *  beside it again without moving what is already stored. */
export const ENGINE = 'supertonic';
/** The voice's name as a screen says it. */
export const ENGINE_LABEL = 'Supertonic';
/** The one-time download: four ONNX models as published, float32 and
 *  unquantised. */
export const MODEL_MB = 380;

/** Can this browser run the voice at all? A worker and WebAssembly are the
 *  whole requirement; WebGPU only makes it faster. */
const canGenerate = (): boolean =>
  typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';

/** What the voice is doing, as a screen says it:
 *  `idle` before anything is asked for and after it is called off, `loading`
 *  through the one-time download, `ready` when it can speak, `busy` while a
 *  clip is being made, `error` when the last thing asked for failed. */
export type VoicePhase = 'idle' | 'loading' | 'ready' | 'busy' | 'error';

/** The whole of what a screen shows about the voice. Every field is always
 *  present: a new status is merged over the last, never replaces it. */
export interface VoiceStatus {
  /** Which of the five things it is doing. */
  phase: VoicePhase;
  /** The sentence to show, or `''` where there is nothing to say. */
  text: string;
  /** How far the download has got, 0..1. Meaningful while `loading`. */
  progress: number;
}

/** The two halves of the `ready` promise, held so that a message from the
 *  worker — or a cancellation — can settle it from outside. */
interface LoadSettle {
  /** Called once the worker says it can speak. */
  resolve: () => void;
  /** Called when the load failed, or was called off. */
  reject: (err: Error) => void;
}

/** One `generate` waiting on its reply, by job id. */
interface PendingJob {
  /** Hands the finished clip to whoever asked for it. */
  resolve: (reply: DoneReply) => void;
  /** Fails that caller: the worker errored, or the voice was cancelled. */
  reject: (err: Error) => void;
}

/** The worker, once started. Null before that, and again after `cancel()`. */
let worker: Worker | null = null;
/** The load in flight or done, so every caller waits on one download. Null
 *  where nothing has been started, or where the last attempt failed. */
let ready: Promise<void> | null = null;
/** How to settle `ready`. Null whenever `ready` is. */
let settle: LoadSettle | null = null;
/** The last job id handed out. Ids only have to be unique within one worker. */
let seq = 0;
/** Jobs the worker has not answered yet. */
const pending = new Map<number, PendingJob>();
/** Everyone watching the status, in the order they subscribed. */
const listeners = new Set<(status: VoiceStatus) => void>();
/** What the voice is doing now, and what every new listener is told first:
 *  idle | loading | ready | busy | error. */
let status: VoiceStatus = { phase: 'idle', text: '', progress: 0 };

/** Merges a change into the status and tells everyone watching. Fields left
 *  out keep their last value, so a phase can be changed without restating the
 *  text beside it. */
function emit(next: Partial<VoiceStatus>): void {
  status = { ...status, ...next };
  for (const fn of listeners) fn(status);
}

/** Watch what the voice is doing. Calls back at once with the state as it is,
 *  so a screen that mounts mid-download shows the progress rather than
 *  nothing, and returns the unsubscribe. */
export function onStatus(fn: (status: VoiceStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

/** The worker, started on first use. One per page: it holds the model, and a
 *  second one would mean a second 380 MB. */
function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./tts/supertonic.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = ({ data }: MessageEvent<TtsReply>) => {
    if (data.type === 'progress') {
      if (data.status === 'progress' && data.total) {
        const mb = (n: number): string => (n / 1048576).toFixed(0);
        emit({
          phase: 'loading',
          text: `preparing the voice, ${mb(data.loaded)} of ${mb(data.total)} MB`,
          progress: data.progress / 100,
        });
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
    /* What is left is about one job. An error with no id is the load itself
       failing, which nothing is queued behind. */
    const job = data.id === null ? undefined : pending.get(data.id);
    if (!job || data.id === null) {
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
  worker.onerror = (err) =>
    emit({ phase: 'error', text: err.message || 'the voice worker failed' });
  return worker;
}

/** Has this device already fetched the model? Then nothing needs asking. */
export async function modelCached(): Promise<boolean> {
  return (await getSettings())[`${ENGINE}Ready`];
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
    ready = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    ready.catch(() => {}); /* a caller that only starts it is not a failure */
    w.postMessage({ type: 'load' } satisfies TtsRequest);
  }
  return ready;
}

/** How a clip is to be made. */
interface SynthesiseOptions {
  /** A multiplier on the model's own pace; 1 is its own. */
  speed?: number;
}

/** One clip, made by the worker. Waits for the model where it is not loaded
 *  yet, so a caller never has to warm it up first. */
async function synthesise(
  text: string,
  lang: SpeechLang,
  { speed = 1 }: SynthesiseOptions = {},
): Promise<DoneReply> {
  const w = ensureWorker();
  await warmUp();
  const id = ++seq;
  emit({ phase: 'busy', text: `making audio for “${text}”` });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: 'generate', id, text, lang, speed } satisfies TtsRequest);
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
export function clipText(rec: StudyWord | null | undefined, kind: ClipKind): string {
  const text =
    kind === 'fr'
      ? withDefiniteArticle(rec?.fr ?? '', rec?.pos ?? '', rec?.gender ?? '', rec?.number ?? '')
      : (Array.isArray(rec?.en) ? rec?.en[0] : rec?.en) || '';
  return text.split(';')[0].trim();
}

/** Clips a word still lacks. */
async function missingClips(key: WordKey): Promise<ClipKind[]> {
  const have = new Set(
    (await clipsFor(key)).filter((c) => c.engine === ENGINE).map((c) => c.kind),
  );
  return KINDS.filter((kind) => !have.has(kind));
}

/** Clips that no longer say what the word says: the spelling was corrected, or
 *  the English was. They are not thrown away — a card with an out-of-date clip
 *  is better than a silent one, as long as it says so — but nothing plays them
 *  until they are made again. */
async function staleClips(rec: StudyWord): Promise<ClipKind[]> {
  const clips = (await clipsFor(rec.k)).filter((c) => c.engine === ENGINE);
  return clips
    .filter((c) => clipText(rec, c.kind) && c.text !== clipText(rec, c.kind))
    .map((c) => c.kind);
}

/** How a word stands for the voice: everything it needs and up to date, made
 *  before a correction, not made at all, or nothing to say. */
export type ClipsState = 'ready' | 'stale' | 'missing' | 'none';

/** 'ready' | 'stale' | 'missing' | 'none' — 'none' being a word with nothing to
 *  say, which is a word with no English yet. */
export async function clipsState(rec: StudyWord): Promise<ClipsState> {
  const wanted = KINDS.filter((kind) => clipText(rec, kind));
  if (!wanted.length) return 'none';
  if ((await missingClips(rec.k)).some((kind) => wanted.includes(kind))) return 'missing';
  return (await staleClips(rec)).length ? 'stale' : 'ready';
}

/** The voice saying a whole example sentence.
 *
 *  Kept under a key of its own — "<word key>#ex0" — so the two clips a word's
 *  card needs are counted and checked without these in the way. Made only when
 *  the voice is already on the device: a sentence is not worth a 380 MB
 *  download nobody asked for, and the browser's own voice is the fallback.
 *  Stored once, so the second time the card comes round it plays at once.
 */
export async function sentenceClip(
  wordKey: WordKey | null | undefined,
  index: number,
  text: string | null | undefined,
): Promise<Clip | null> {
  const cue = (text ?? '').trim();
  if (!cue || !wordKey) return null;
  const key = `${wordKey}#ex${index}`;
  const id = clipId(key, 'fr', ENGINE);
  const have = await getClip(id);
  if (have?.text === cue) return have;
  if (!canGenerate() || !(await modelCached())) return null;
  const { blob, genMs, audioMs, backend } = await synthesise(cue, 'fr');
  const clip: Clip = {
    id,
    key,
    kind: 'fr',
    engine: ENGINE,
    text: cue,
    blob,
    genMs,
    audioMs,
    backend,
    createdAt: Date.now(),
  };
  await putClip(clip);
  return clip;
}

/** One clip that was just made, and what it cost. */
export interface MadeClip {
  /** Which side of the card it says. */
  kind: ClipKind;
  /** Milliseconds the worker spent making it. */
  genMs: number;
  /** Milliseconds of audio it produced. */
  audioMs: number;
}

/** Make and store the clips one of your words is missing or has outgrown, each
 *  with the time it took, so a device that struggles says so. */
export async function ensureClips(rec: StudyWord): Promise<MadeClip[]> {
  const todo = new Set([...(await missingClips(rec.k)), ...(await staleClips(rec))]);
  const made: MadeClip[] = [];
  for (const kind of KINDS) {
    if (!todo.has(kind)) continue;
    const cue = clipText(rec, kind);
    if (!cue) continue;
    const { blob, genMs, audioMs, backend } = await synthesise(cue, kind);
    await putClip({
      id: clipId(rec.k, kind, ENGINE),
      key: rec.k,
      kind,
      engine: ENGINE,
      text: cue,
      blob,
      genMs,
      audioMs,
      backend,
      createdAt: Date.now(),
    });
    made.push({ kind, genMs, audioMs });
  }
  return made;
}

/** Whether the voice may be started without asking: `ready` once the model is
 *  on the device, `needs-download` where it would cost 380 MB, `offline` where
 *  that download cannot happen, `unsupported` where the browser cannot run it
 *  at all. */
export type GenerationState = 'unsupported' | 'ready' | 'needs-download' | 'offline';

/** May we start now without asking? Offline with no model is a plain no. */
export async function generationState(): Promise<GenerationState> {
  if (!canGenerate()) return 'unsupported';
  if (await modelCached()) return 'ready';
  return isOnline() ? 'needs-download' : 'offline';
}

/** What one voice's one-time load cost on this device. */
export interface VoiceLoad {
  /** Milliseconds the load took, or null where it has not been measured. */
  loadMs: number | null;
  /** Which ONNX backend ran it, or null where nothing has run yet. */
  backend: string | null;
}

/** What the voice cost on this device: the one-time load, and which backend
 *  ran it. The per-word time lives on the clips themselves. */
export async function loadTimes(): Promise<Record<string, VoiceLoad>> {
  const settings = await getSettings();
  return {
    [ENGINE]: {
      loadMs: settings[`${ENGINE}LoadMs`] ?? null,
      backend: settings[`${ENGINE}Backend`] ?? null,
    },
  };
}

/** Passed through so a screen that shows a clip need not also know where the
 *  clips are kept. */
export { getClip };
