/** Supertonic 3: the pipeline, with nothing browser-shaped in it. Four models
 *  in a row, steered by a voice of two style tensors. */

/* The duration predictor says how long the sentence will take to say; the text
   encoder turns the letters into embeddings; the vector estimator denoises a
   latent of that length in a handful of flow matching steps; the vocoder turns
   the latent into a waveform. The two style tensors steer the first and the
   rest.

   It takes letters, not phonemes — the text goes in wrapped in a language tag
   and indexed per Unicode code point — so there is no grapheme-to-phoneme step,
   and no phoneme string to store beside a clip.

   Ported from the reference web example at github.com/supertone-inc/supertonic
   (MIT); the weights are OpenRAIL-M. `ort` and `read` are passed in so the same
   code runs in the worker and under `node --test` against real weights. */
import type * as OrtModule from 'onnxruntime-web';

/** The four ONNX files, in the order they are loaded and then run. Also the
 *  keys the sessions are held under. */
export const MODELS = ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder'];
/* More is slower and not audibly better at this length. */
/** How many flow matching steps the latent is denoised in. */
export const TOTAL_STEP = 8; /* denoising steps: the reference default */

/** Supertonic's own language codes; the app only ever speaks two of them. */
const LANG: Record<string, string> = { fr: 'fr', en: 'en' };

/** ONNX Runtime itself, whichever build the caller has: the worker hands in
 *  `onnxruntime-web/webgpu`, a test hands in whatever it loaded the weights
 *  with. Only the tensor and the session are reached for. */
export type OrtRuntime = typeof OrtModule;

/** What the pipeline needs to exist before it can say anything. */
export interface SupertonicOptions {
  /* Injected rather than imported, so this file pulls no browser bundle in
     behind it. */
  /** ONNX Runtime itself. */
  ort: OrtRuntime;
  /** Bytes for one of the model's files, named relative to the model root —
   *  `onnx/vocoder.onnx`, `voice_style`. Where they come from, and whether
   *  they are cached, is the caller's business. */
  read: (path: string) => Promise<ArrayBuffer>;
  /* The caller decides the fallback, because which backend ran has to be
     reported. */
  /** ONNX backends to try, in the runtime's own order; one entry. Defaults to
   *  `['wasm']`. */
  executionProviders?: string[];
}

/** The model's own configuration, as `onnx/tts.json` ships it. Only the
 *  fields the pipeline reads are named. */
interface SupertonicConfig {
  /** The autoencoder: what the waveform is made of. */
  ae: {
    /** Samples per second of the audio it produces. */
    sample_rate: number;
    /** Samples one latent frame stands for, before compression. */
    base_chunk_size: number;
  };
  /** The latent transformer: what is denoised. */
  ttl: {
    /** Channels per latent frame, before compression. */
    latent_dim: number;
    /** How many frames are packed into one, which multiplies the dimension
     *  and divides the length. */
    chunk_compress_factor: number;
  };
}

/** One tensor of the voice file, as JSON stores it: the numbers nested to the
 *  tensor's rank, and the shape beside them. */
interface StylePart {
  /** The values, nested as deep as `dims` is long. */
  data: number[];
  /** The shape, outermost first. */
  dims: number[];
}

/** A voice: the two style tensors that steer the pipeline. */
interface VoiceStyle {
  /** Steers the duration predictor — how fast this voice speaks. */
  style_dp: StylePart;
  /** Steers the text encoder and the vector estimator — how it sounds. */
  style_ttl: StylePart;
}

/** What one run of the pipeline produces. */
export interface Speech {
  /** The waveform, mono, floats in -1..1. */
  samples: Float32Array;
  /** Samples per second, from the model's own configuration. */
  sampleRate: number;
}

/** The pipeline, once built: four sessions and the voice they are steered by,
 *  held for as long as the caller keeps this object. */
export interface Supertonic {
  /** Fetches the configuration, the voice and the four models, one at a time,
   *  and reports the sample rate they agree on. */
  load(): Promise<{ sampleRate: number }>;
  /** One word or short phrase to samples. Only valid after `load()`. */
  synthesise(text: string, lang: string, speed?: number): Promise<Speech>;
  /* Exposed so it can be tested without loading 380 MB. */
  /** The text as the model was trained to see it. */
  normalise(text: string, lang: string): string;
  /** Samples per second, 0 until `load()` has resolved. */
  readonly sampleRate: number;
}

/** Builds the pipeline. Nothing is fetched until `load()` is called. */
export function createSupertonic({
  ort,
  read,
  executionProviders = ['wasm'],
}: SupertonicOptions): Supertonic {
  /* Each of these is assigned by load() and read only after it: reaching the
     pipeline before the weights are there is a programming error, and throws
     as one. */
  /** The model's configuration, as `onnx/tts.json` shipped it. */
  let cfg: SupertonicConfig;
  /** Code point to token index, as `onnx/unicode_indexer.json` shipped it. A
   *  point past the end, or one the table has no entry for, is -1. */
  let indexer: number[];
  /** The voice, as the two tensors that steer the chain. */
  let style: { dp: OrtModule.Tensor; ttl: OrtModule.Tensor };
  /** The four sessions, under the names in MODELS. */
  let models: Record<string, OrtModule.InferenceSession>;
  /** Samples per second the vocoder produces; 0 until loaded. */
  let sampleRate = 0;

  /** One style tensor, flattened out of its JSON nesting into the flat
   *  Float32Array the runtime wants, keeping the shape it declares. */
  const tensor = (part: StylePart): OrtModule.Tensor =>
    new ort.Tensor('float32', Float32Array.from(part.data.flat(Infinity)), part.dims);

  /** Fetches everything and builds the sessions. Resolves once the pipeline
   *  can speak; rejects with whatever the runtime said if a backend cannot
   *  run, so the caller can try the next one. */
  async function load(): Promise<{ sampleRate: number }> {
    const [cfgBytes, indexerBytes, voiceBytes] = await Promise.all([
      read('onnx/tts.json'),
      read('onnx/unicode_indexer.json'),
      read('voice_style'),
    ]);
    /** One of the JSON files, decoded. `JSON.parse` really does return
     *  anything, so the shape is named at each call site — they are the
     *  model's own and this helper cannot know them. */
    const json = (bytes: ArrayBuffer): unknown => JSON.parse(new TextDecoder().decode(bytes));
    cfg = json(cfgBytes) as SupertonicConfig;
    indexer = json(indexerBytes) as number[];
    const voice = json(voiceBytes) as VoiceStyle;
    style = { dp: tensor(voice.style_dp), ttl: tensor(voice.style_ttl) };
    sampleRate = cfg.ae.sample_rate;
    /* One at a time: four sessions and 380 MB of weights at once is more than
       a phone will hold. */
    models = {};
    for (const name of MODELS) {
      const bytes = await read(`onnx/${name}.onnx`);
      models[name] = await ort.InferenceSession.create(new Uint8Array(bytes), {
        executionProviders,
        graphOptimizationLevel: 'all',
      });
    }
    return { sampleRate };
  }

  /** The reference normaliser, kept whole: the model was trained on text that
   *  went through it, including the full stop it adds to a bare word. */
  function normalise(text: string, lang: string): string {
    let out = text
      .normalize('NFKD')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '')
      .replace(/[–‑—]/g, '-')
      .replace(/[_[\]|/#→←]/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[‘’´`]/g, "'")
      .replace(/[♥☆♡©\\]/g, '')
      .replace(/@/g, ' at ')
      .replace(/ ([,.!?;:'])/g, '$1')
      .replace(/""+/g, '"')
      .replace(/''+/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!/[.!?;:,'")\]}…]$/.test(out)) out += '.';
    return `<${LANG[lang] ?? lang}>${out}</${LANG[lang] ?? lang}>`;
  }

  /** The normalised text as the two tensors every model of the chain takes:
   *  one index per code point, and a mask the same length saying every
   *  position is real. */
  function textTensors(
    text: string,
    lang: string,
  ): { ids: OrtModule.Tensor; mask: OrtModule.Tensor } {
    const marked = normalise(text, lang);
    const ids = new BigInt64Array(marked.length);
    for (let i = 0; i < marked.length; i++) {
      /* An index inside the string always has a code point; the fallback is
         the same -1 that an unknown point maps to. */
      const point = marked.codePointAt(i) ?? -1;
      ids[i] = BigInt(point < indexer.length ? (indexer[point] ?? -1) : -1);
    }
    return {
      ids: new ort.Tensor('int64', ids, [1, marked.length]),
      mask: new ort.Tensor('float32', new Float32Array(marked.length).fill(1), [
        1,
        1,
        marked.length,
      ]),
    };
  }

  /** Gaussian noise the size of the speech to come, which is why the duration
   *  is predicted first. Box-Muller, as in the reference. */
  function noise(seconds: number): { latent: OrtModule.Tensor; mask: OrtModule.Tensor } {
    const chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
    const dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
    const len = Math.max(1, Math.ceil(Math.floor(seconds * sampleRate) / chunk));
    const data = new Float32Array(dim * len);
    for (let i = 0; i < data.length; i++) {
      const u1 = Math.max(1e-4, Math.random());
      data[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
    }
    return {
      latent: new ort.Tensor('float32', data, [1, dim, len]),
      mask: new ort.Tensor('float32', new Float32Array(len).fill(1), [1, 1, len]),
    };
  }

  /** One word or short phrase to samples. `speed` divides the predicted
   *  duration; 1 is the model's own pace. */
  async function synthesise(text: string, lang: string, speed = 1): Promise<Speech> {
    /* Long text would want the reference chunker; a flashcard cue never reaches
       that length. */
    const { ids, mask } = textTensors(text, lang);

    const { duration } = await models.duration_predictor.run({
      text_ids: ids,
      style_dp: style.dp,
      text_mask: mask,
    });
    const seconds = Number(duration.data[0]) / speed;

    const { text_emb: textEmb } = await models.text_encoder.run({
      text_ids: ids,
      style_ttl: style.ttl,
      text_mask: mask,
    });

    /* The latent is replaced on every step of the solver; its mask is not. */
    const noised = noise(seconds);
    const latentMask = noised.mask;
    let latent = noised.latent;
    const total = new ort.Tensor('float32', new Float32Array([TOTAL_STEP]), [1]);
    for (let step = 0; step < TOTAL_STEP; step++) {
      const out = await models.vector_estimator.run({
        noisy_latent: latent,
        text_emb: textEmb,
        style_ttl: style.ttl,
        latent_mask: latentMask,
        text_mask: mask,
        current_step: new ort.Tensor('float32', new Float32Array([step]), [1]),
        total_step: total,
      });
      latent = out.denoised_latent;
    }

    const { wav_tts: wav } = await models.vocoder.run({ latent });
    /* The vocoder's one output is float32 by construction; the runtime's own
       type covers every tensor it could ever return. */
    return { samples: wav.data as Float32Array, sampleRate };
  }

  return {
    load,
    synthesise,
    normalise,
    get sampleRate() {
      return sampleRate;
    },
  };
}
