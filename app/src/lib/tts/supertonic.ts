/** Supertonic 3: the pipeline, with nothing browser-shaped in it.
 *
 *  Four models in a row. The duration predictor says how long the sentence
 *  will take to say; the text encoder turns the letters into embeddings; the
 *  vector estimator denoises a latent of that length in a handful of flow
 *  matching steps; the vocoder turns the latent into a waveform. The voice is
 *  two style tensors that steer the first and the rest.
 *
 *  It takes letters, not phonemes — the text goes in wrapped in a language tag
 *  and indexed per Unicode code point — so there is no grapheme-to-phoneme
 *  step, and no phoneme string to store beside a clip.
 *
 *  Ported from the reference web example at github.com/supertone-inc/supertonic
 *  (MIT); the weights are OpenRAIL-M. `ort` and `read` are passed in so the
 *  same code runs in the worker and under a test runner against real weights.
 */
export const MODELS = ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder'] as const;
export type ModelName = (typeof MODELS)[number];
export const TOTAL_STEP = 8;         /* denoising steps: the reference default */

/** Supertonic's own language codes; the app only ever speaks two of them. */
const LANG: Record<string, string> = { fr: 'fr', en: 'en' };

/** The part of ONNX Runtime this pipeline uses.
 *
 *  Declared structurally rather than imported, because the runtime is passed
 *  in: the worker hands it the WebGPU build, and a test hands it the Node one
 *  to run the same code against the real weights. */
export interface OrtTensor {
  readonly data: Float32Array | BigInt64Array | ArrayLike<number>;
  readonly dims: readonly number[];
}
export interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
export interface OrtLike {
  Tensor: new (
    type: 'float32' | 'int64',
    data: Float32Array | BigInt64Array,
    dims: number[],
  ) => OrtTensor;
  InferenceSession: {
    create(bytes: Uint8Array, options: {
      executionProviders: string[];
      graphOptimizationLevel: string;
    }): Promise<OrtSession>;
  };
}

/** The voice's own configuration, as shipped beside the weights. */
interface VoiceConfig {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { latent_dim: number; chunk_compress_factor: number };
}

/** A style tensor as it is stored: nested arrays and their shape. */
interface StylePart { data: unknown[]; dims: number[] }

export interface Supertonic {
  load(): Promise<{ sampleRate: number }>;
  synthesise(text: string, lang: string, speed?: number): Promise<{
    samples: ArrayLike<number>;
    sampleRate: number;
  }>;
  normalise(text: string, lang: string): string;
  readonly sampleRate: number;
}

export function createSupertonic({ ort, read, executionProviders = ['wasm'] }: {
  ort: OrtLike;
  /** Bytes for one shipped asset, by its path in the repository. */
  read: (path: string) => Promise<ArrayBuffer | Uint8Array>;
  executionProviders?: string[];
}): Supertonic {
  let cfg: VoiceConfig | null = null;
  let indexer: number[] = [];
  let style: { dp: OrtTensor; ttl: OrtTensor } | null = null;
  let models: Record<ModelName, OrtSession> | null = null;
  let sampleRate = 0;

  const tensor = (part: StylePart): OrtTensor =>
    new ort.Tensor('float32',
      Float32Array.from((part.data as number[]).flat(Infinity)), part.dims);

  async function load(): Promise<{ sampleRate: number }> {
    const [cfgBytes, indexerBytes, voiceBytes] = await Promise.all([
      read('onnx/tts.json'), read('onnx/unicode_indexer.json'), read('voice_style'),
    ]);
    const json = <T>(bytes: ArrayBuffer | Uint8Array): T =>
      JSON.parse(new TextDecoder().decode(bytes)) as T;
    cfg = json<VoiceConfig>(cfgBytes);
    indexer = json<number[]>(indexerBytes);
    const voice = json<{ style_dp: StylePart; style_ttl: StylePart }>(voiceBytes);
    style = { dp: tensor(voice.style_dp), ttl: tensor(voice.style_ttl) };
    sampleRate = cfg.ae.sample_rate;
    /* One at a time: four sessions and 380 MB of weights at once is more than
       a phone will hold. */
    const made = {} as Record<ModelName, OrtSession>;
    for (const name of MODELS) {
      const bytes = await read(`onnx/${name}.onnx`);
      made[name] = await ort.InferenceSession.create(new Uint8Array(bytes),
        { executionProviders, graphOptimizationLevel: 'all' });
    }
    models = made;
    return { sampleRate };
  }

  /** The reference normaliser, kept whole: the model was trained on text that
   *  went through it, including the full stop it adds to a bare word. */
  function normalise(text: string, lang: string): string {
    let out = text.normalize('NFKD')
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

  function textTensors(text: string, lang: string): { ids: OrtTensor; mask: OrtTensor } {
    const marked = normalise(text, lang);
    const ids = new BigInt64Array(marked.length);
    for (let i = 0; i < marked.length; i++) {
      const point = marked.codePointAt(i) ?? -1;
      ids[i] = BigInt(point >= 0 && point < indexer.length ? indexer[point] ?? -1 : -1);
    }
    return {
      ids: new ort.Tensor('int64', ids, [1, marked.length]),
      mask: new ort.Tensor('float32', new Float32Array(marked.length).fill(1), [1, 1, marked.length]),
    };
  }

  /** Gaussian noise the size of the speech to come, which is why the duration
   *  is predicted first. Box-Muller, as in the reference. */
  function noise(seconds: number): { latent: OrtTensor; mask: OrtTensor } {
    const c = ready();
    const chunk = c.ae.base_chunk_size * c.ttl.chunk_compress_factor;
    const dim = c.ttl.latent_dim * c.ttl.chunk_compress_factor;
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

  /** One word or short phrase to samples. Long text would want the reference
   *  chunker; a flashcard cue never reaches that length. */
  /** The configuration, once `load` has run. Reaching the pipeline before
   *  then is a programming error, not a runtime condition. */
  function ready(): VoiceConfig {
    if (!cfg) throw new Error('the voice has not been loaded');
    return cfg;
  }

  async function synthesise(text: string, lang: string, speed = 1): Promise<{
    samples: ArrayLike<number>;
    sampleRate: number;
  }> {
    if (!models || !style) throw new Error('the voice has not been loaded');
    const { ids, mask } = textTensors(text, lang);

    const { duration } = await models.duration_predictor.run(
      { text_ids: ids, style_dp: style.dp, text_mask: mask });
    const seconds = Number(duration?.data[0] ?? 0) / speed;

    const { text_emb: textEmb } = await models.text_encoder.run(
      { text_ids: ids, style_ttl: style.ttl, text_mask: mask });
    if (!textEmb) throw new Error('the text encoder returned nothing');

    const seed = noise(seconds);
    let latent = seed.latent;
    const latentMask = seed.mask;
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
      if (!out.denoised_latent) throw new Error('the vector estimator returned nothing');
      latent = out.denoised_latent;
    }

    const { wav_tts: wav } = await models.vocoder.run({ latent });
    if (!wav) throw new Error('the vocoder returned nothing');
    /* The vocoder's output is float32 by construction: a waveform. */
    return { samples: wav.data as ArrayLike<number>, sampleRate };
  }

  return { load, synthesise, normalise, get sampleRate(): number { return sampleRate; } };
}
