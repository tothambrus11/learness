/** How the two voices compare on this device, measured from the clips they
 *  have actually made here. */

/* Every clip carries the time its worker spent making it, so the comparison is
   measured rather than quoted from a benchmark run on someone's laptop.
   Medians, not means: one word synthesised while the phone was busy elsewhere
   should not decide the verdict. */
import type { Clip } from './types';

/** The middle value, or the mean of the middle two. Null for nothing to take
 *  the middle of, which a caller must show as "—" rather than as zero. The
 *  list it is given is left in the order it came in. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One voice's record on this device. */
export interface TimingRow {
  /** The voice that made the clips: `kokoro`, `supertonic`. */
  engine: string;
  /** How many timed clips it has made, counting only those this row covers. */
  clips: number;
  /** Median milliseconds to make one clip. Never null in a row this builds —
   *  a row exists only where a timed clip does — but it is median's answer,
   *  and median has nothing to say about an empty list. */
  perWord: number | null;
  /** Median generation time over the audio produced: 1 is real time, below 1
   *  is faster than a person could say it. Null where no clip recorded how
   *  long its audio ran. */
  rtf: number | null;
  /** The ONNX backend the most recent clip ran on, or null where it was not
   *  recorded. */
  backend: string | null;
}

/** One row per voice that has made anything, slowest last. Only clips with a
 *  recorded generation time count; `kind` narrows to one kind of clip, and null
 *  counts them all. */
export function summariseTimings(
  clips: readonly Clip[],
  kind: Clip['kind'] | null = null,
): TimingRow[] {
  const byEngine = new Map<string, Clip[]>();
  for (const clip of clips) {
    if (!clip.engine || !((clip.genMs ?? 0) > 0)) continue;
    if (kind && clip.kind !== kind) continue;
    if (!byEngine.has(clip.engine)) byEngine.set(clip.engine, []);
    byEngine.get(clip.engine)?.push(clip);
  }
  const rows = [];
  for (const [engine, made] of byEngine) {
    const rtfs = made
      .filter((c) => (c.audioMs ?? 0) > 0)
      .map((c) => (c.genMs ?? 0) / (c.audioMs ?? 0));
    rows.push({
      engine,
      clips: made.length,
      perWord: median(made.map((c) => c.genMs ?? 0)),
      rtf: median(rtfs),
      backend: made[made.length - 1].backend ?? null,
    });
  }
  return rows.sort((a, b) => (a.perWord ?? 0) - (b.perWord ?? 0));
}

/** Seconds for anything a person would call slow, milliseconds below that. */
export function duration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  return `${Math.round(ms / 60000)} min`;
}
