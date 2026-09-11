/** A waveform as a file the browser can play: 16-bit PCM in a WAV
 *  container. */

/** Bytes of the fmt chunk that follow its own length field, which is what an
 *  uncompressed header holds. */
const FMT_CHUNK_BYTES = 16;

/** The WAV format code for uncompressed PCM. */
const FORMAT_PCM = 1;

/** Channels in the file: the vocoder produces one. */
const MONO = 1;

/** The samples, which are floats in -1..1 as the vocoder produces them, in a
 *  mono WAV at the given rate. Anything outside the range is clipped rather
 *  than allowed to wrap, which would be heard as a crack. */
export function wavBlob(samples: ArrayLike<number>, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  /** Writes a chunk name at a byte offset. The names are all ASCII, so one
   *  byte per character is the whole of it. */
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, FMT_CHUNK_BYTES, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, MONO, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  const pcm = new Int16Array(buffer, 44);
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
