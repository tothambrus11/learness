/** A waveform as a file the browser can play.
 *
 *  16-bit PCM in a WAV container: every browser plays it from an object URL,
 *  and IndexedDB stores the blob as it is.
 */
export function wavBlob(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (at, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);        /* rest of the fmt chunk */
  view.setUint16(20, 1, true);         /* PCM */
  view.setUint16(22, 1, true);         /* mono */
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
