import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duration, median, summariseTimings } from '../src/lib/timing.js';

const clip = (engine, kind, genMs, audioMs) =>
  ({ engine, kind, genMs, audioMs, backend: engine === 'supertonic' ? 'webgpu' : 'wasm' });

const clips = [
  clip('kokoro', 'fr', 900, 700), clip('kokoro', 'fr', 1100, 800), clip('kokoro', 'en', 5000, 600),
  clip('supertonic', 'fr', 400, 800), clip('supertonic', 'fr', 600, 900),
  { engine: 'kokoro', kind: 'fr', genMs: 0, audioMs: 0 },        /* an older clip, never timed */
];

test('each voice is summarised by its median, fastest first', () => {
  const rows = summariseTimings(clips);
  assert.deepEqual(rows.map((r) => r.engine), ['supertonic', 'kokoro']);
  assert.equal(rows[0].clips, 2);
  assert.equal(rows[0].perWord, 500);
  assert.equal(rows[1].perWord, 1100, 'the untimed clip is left out, the slow English one is not');
  assert.equal(rows[1].clips, 3);
});

test('real-time factor is generation over the audio it made', () => {
  const [fast] = summariseTimings(clips, 'fr');
  assert.equal(fast.engine, 'supertonic');
  assert.ok(Math.abs(fast.rtf - (0.5 + 600 / 900) / 2) < 1e-9, 'median of 400/800 and 600/900');
  assert.equal(fast.backend, 'webgpu');
});

test('one French word does not borrow the English timing', () => {
  const rows = summariseTimings(clips, 'fr');
  assert.equal(rows.find((r) => r.engine === 'kokoro').perWord, 1000);
});

test('a voice that has made nothing has no row', () => {
  assert.deepEqual(summariseTimings([]), []);
  assert.equal(median([]), null);
});

test('durations are read at the scale a person would say them', () => {
  assert.equal(duration(null), '—');
  assert.equal(duration(420), '420 ms');
  assert.equal(duration(1500), '1.5 s');
  assert.equal(duration(42000), '42 s');
  assert.equal(duration(180000), '3 min');
});
