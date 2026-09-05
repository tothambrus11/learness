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
 *  same code runs in the worker and under `node --test` against real weights.
 */
export const MODELS = ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder'];
export const TOTAL_STEP = 8;         /* denoising steps: the reference default */

/** Supertonic's own language codes; the app only ever speaks two of them. */
const LANG = { fr: 'fr', en: 'en' };

export function createSupertonic({ ort, read, executionProviders = ['wasm'] }) {
  let cfg = null;
  let indexer = null;
  let style = null;
  let models = null;
  let sampleRate = 0;

  const tensor = (part) =>
    new ort.Tensor('float32', Float32Array.from(part.data.flat(Infinity)), part.dims);

  async function load() {
    const [cfgBytes, indexerBytes, voiceBytes] = await Promise.all([
      read('onnx/tts.json'), read('onnx/unicode_indexer.json'), read('voice_style'),
    ]);
    const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
    cfg = json(cfgBytes);
    indexer = json(indexerBytes);
    const voice = json(voiceBytes);
    style = { dp: tensor(voice.style_dp), ttl: tensor(voice.style_ttl) };
    sampleRate = cfg.ae.sample_rate;
    /* One at a time: four sessions and 380 MB of weights at once is more than
       a phone will hold. */
    models = {};
    for (const name of MODELS) {
      const bytes = await read(`onnx/${name}.onnx`);
      models[name] = await ort.InferenceSession.create(new Uint8Array(bytes),
        { executionProviders, graphOptimizationLevel: 'all' });
    }
    return { sampleRate };
  }

  /** The reference normaliser, kept whole: the model was trained on text that
   *  went through it, including the full stop it adds to a bare word. */
  function normalise(text, lang) {
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

  function textTensors(text, lang) {
    const marked = normalise(text, lang);
    const ids = new BigInt64Array(marked.length);
    for (let i = 0; i < marked.length; i++) {
      const point = marked.codePointAt(i);
      ids[i] = BigInt(point < indexer.length ? indexer[point] ?? -1 : -1);
    }
    return {
      ids: new ort.Tensor('int64', ids, [1, marked.length]),
      mask: new ort.Tensor('float32', new Float32Array(marked.length).fill(1), [1, 1, marked.length]),
    };
  }

  /** Gaussian noise the size of the speech to come, which is why the duration
   *  is predicted first. Box-Muller, as in the reference. */
  function noise(seconds) {
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

  /** One word or short phrase to samples. Long text would want the reference
   *  chunker; a flashcard cue never reaches that length. */
  async function synthesise(text, lang, speed = 1) {
    const { ids, mask } = textTensors(text, lang);

    const { duration } = await models.duration_predictor.run(
      { text_ids: ids, style_dp: style.dp, text_mask: mask });
    const seconds = Number(duration.data[0]) / speed;

    const { text_emb: textEmb } = await models.text_encoder.run(
      { text_ids: ids, style_ttl: style.ttl, text_mask: mask });

    let { latent, mask: latentMask } = noise(seconds);
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
    return { samples: wav.data, sampleRate };
  }

  return { load, synthesise, normalise, get sampleRate() { return sampleRate; } };
}
