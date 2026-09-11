/** How the two voices are compared from the clips they have actually made. */
import { expect, test } from 'vitest';

import { duration, median, summariseTimings } from '../src/lib/timing';
import type { Clip } from '../src/lib/types';

/** One stored clip. Only the engine, the kind and the two durations are read
 *  by the summary, so the rest is filler; the backend follows the engine, as
 *  it does on a device. Pass `backend` explicitly to say it was never
 *  recorded. */
const clip = (
  engine: string,
  kind: Clip['kind'],
  genMs: number,
  audioMs: number,
  backend: string | null = engine === 'supertonic' ? 'webgpu' : 'wasm',
): Clip => ({
  id: `${engine}|${kind}|${genMs}`,
  key: 'bug|noun',
  kind,
  engine,
  text: 'le bug',
  blob: new Blob(),
  genMs,
  audioMs,
  backend,
  createdAt: 0,
});

/** Two voices' output: kokoro with a slow English clip among its French ones,
 *  supertonic with two quick French ones, and one clip from before anything
 *  was timed. */
const clips: Clip[] = [
  clip('kokoro', 'fr', 900, 700),
  clip('kokoro', 'fr', 1100, 800),
  clip('kokoro', 'en', 5000, 600),
  clip('supertonic', 'fr', 400, 800),
  clip('supertonic', 'fr', 600, 900),
  clip('kokoro', 'fr', 0, 0, null) /* an older clip, never timed */,
];

test('each voice is summarised by its median, fastest first', () => {
  const rows = summariseTimings(clips);
  expect(rows.map((r) => r.engine)).toEqual(['supertonic', 'kokoro']);
  expect(rows[0].clips).toBe(2);
  expect(rows[0].perWord).toBe(500);
  expect(rows[1].perWord, 'the untimed clip is left out, the slow English one is not').toBe(
    1100,
  );
  expect(rows[1].clips).toBe(3);
});

test('real-time factor is generation over the audio it made', () => {
  const [fast] = summariseTimings(clips, 'fr');
  expect(fast.engine).toBe('supertonic');
  expect(
    Math.abs((fast.rtf ?? 0) - (0.5 + 600 / 900) / 2) < 1e-9,
    'median of 400/800 and 600/900',
  ).toBeTruthy();
  expect(fast.backend).toBe('webgpu');
});

test('one French word does not borrow the English timing', () => {
  const rows = summariseTimings(clips, 'fr');
  expect(rows.find((r) => r.engine === 'kokoro')?.perWord).toBe(1000);
});

test('a voice that has made nothing has no row', () => {
  expect(summariseTimings([])).toEqual([]);
  expect(median([])).toBe(null);
});

test('durations are read at the scale a person would say them', () => {
  expect(duration(null)).toBe('—');
  expect(duration(420)).toBe('420 ms');
  expect(duration(1500)).toBe('1.5 s');
  expect(duration(42000)).toBe('42 s');
  expect(duration(180000)).toBe('3 min');
});
