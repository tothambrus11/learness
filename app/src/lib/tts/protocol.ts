/** What the page and the voice's worker say to each other. */

/* The worker is a separate bundle, so nothing else checks that the two sides
   agree: a field renamed on one side is a message the other silently ignores.
   Both import these, so that mismatch is a compile error instead. */

/** The two languages the app ever speaks, which are the two sides of a card. */
export type SpeechLang = 'fr' | 'en';

/** Fetch the weights and start the model. Sent once per worker; answered by
 *  `ready` when it can speak, or by an `error` with no `id`. */
export interface LoadRequest {
  /** Names the request. */
  type: 'load';
}

/** Say one word or short phrase. Answered by exactly one `done` or `error`
 *  carrying the same `id`. */
export interface GenerateRequest {
  /** Names the request. */
  type: 'generate';
  /** The job's number, minted by the page and echoed back, so that replies may
   *  arrive in any order and still find the caller waiting on them. */
  id: number;
  /** Exactly what is to be spoken, already trimmed to what the clip records. */
  text: string;
  /** Which language to say it in. */
  lang: SpeechLang;
  /** A multiplier on the predicted duration; 1 is the model's own pace. */
  speed: number;
}

/** Anything the page sends the worker. */
export type TtsRequest = LoadRequest | GenerateRequest;

/* A message per chunk buries the page, hence the rate limit. */
/** How far the one-time download has got. Sent while loading only, four times a
 *  second at most. */
export interface ProgressReply {
  /** Names the reply. */
  type: 'progress';
  /** Always `'progress'`: the worker reports nothing else this way, and the
   *  page checks it rather than assuming. */
  status: 'progress';
  /** Bytes fetched so far, cached ones included. */
  loaded: number;
  /** Bytes expected in total, corrected as each file's real length lands. */
  total: number;
  /** The same fraction as a percentage, 0..100. */
  progress: number;
}

/** The model can speak. Sent once after a `load`, and again if a `generate`
 *  arrives before the load was asked for. */
export interface ReadyReply {
  /** Names the reply. */
  type: 'ready';
  /** Milliseconds the one-time load took. Absent where the load was not the
   *  thing being answered. */
  loadMs?: number;
  /** Which ONNX backend ran it: `webgpu` or `wasm`. Empty before a load. */
  backend: string;
}

/** One clip, made. */
export interface DoneReply {
  /** Names the reply. */
  type: 'done';
  /** The `generate` this answers. */
  id: number;
  /** The audio, as a playable WAV. */
  blob: Blob;
  /** Milliseconds spent making it, the model load excluded. */
  genMs: number;
  /** Milliseconds of audio produced, so a real-time factor can be worked out. */
  audioMs: number;
  /** Which ONNX backend ran it, since that decides the timing. */
  backend: string;
}

/** Something failed. */
export interface ErrorReply {
  /** Names the reply. */
  type: 'error';
  /** The `generate` this answers, or null where the load itself failed and no
   *  job is waiting on it. */
  id: number | null;
  /** What went wrong, in the words the screen shows. */
  message: string;
}

/** Anything the worker sends the page. */
export type TtsReply = ProgressReply | ReadyReply | DoneReply | ErrorReply;
