/** How the two voices compare on this device.
 *
 *  Every clip carries the time its worker spent making it, so the comparison
 *  is measured rather than quoted from a benchmark run on someone's laptop.
 *  Medians, not means: one word synthesised while the phone was busy elsewhere
 *  should not decide the verdict.
 */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One row per voice that has made anything, slowest last.
 *
 *  `perWord` is the median time to make one clip; `rtf` is that time over the
 *  length of the audio it produced, so 1 is real time and less than 1 is
 *  faster than a person could say it. */
export function summariseTimings(clips, kind = null) {
  const byEngine = new Map();
  for (const clip of clips) {
    if (!clip.engine || !(clip.genMs > 0)) continue;
    if (kind && clip.kind !== kind) continue;
    if (!byEngine.has(clip.engine)) byEngine.set(clip.engine, []);
    byEngine.get(clip.engine).push(clip);
  }
  const rows = [];
  for (const [engine, made] of byEngine) {
    const rtfs = made.filter((c) => c.audioMs > 0).map((c) => c.genMs / c.audioMs);
    rows.push({
      engine,
      clips: made.length,
      perWord: median(made.map((c) => c.genMs)),
      rtf: median(rtfs),
      backend: made[made.length - 1].backend ?? null,
    });
  }
  return rows.sort((a, b) => a.perWord - b.perWord);
}

/** Seconds for anything a person would call slow, milliseconds below that. */
export function duration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  return `${Math.round(ms / 60000)} min`;
}
