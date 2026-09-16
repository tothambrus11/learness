/** How many threads the voice's WebAssembly may run on.
 *
 *  A pure rule, because the worker that applies it cannot be unit tested and
 *  the two facts it turns on are easy to get wrong in the dark: whether the
 *  page is cross-origin isolated, without which there is no
 *  `SharedArrayBuffer` and ONNX Runtime falls back to one thread whatever it
 *  is told (#54 — production was never isolated, and the worker's four-thread
 *  request was silently one); and how many cores the device has.
 *
 *  Isolated, the voice takes every core but one, and at most four: a clip
 *  made on four threads takes half the time of one made on one, and more
 *  buys nothing measurable. The one left is for the screen, which on a
 *  four-core phone is otherwise making audio and drawing nothing. Not
 *  isolated, or with a core count the browser does not give (`undefined`, or
 *  a number that is not one), the answer is one thread: the safe count on a
 *  runtime that would take any other as permission to try.
 */
export function threadsFor({ isolated, cores }: {
  /** `self.crossOriginIsolated` where the runtime will run. */
  isolated: boolean;
  /** `navigator.hardwareConcurrency`, which a browser may leave undefined
   *  or, for the sake of fingerprinting, round. */
  cores: number | undefined;
}): number {
  if (!isolated) return 1;
  if (typeof cores !== 'number' || !Number.isFinite(cores) || cores < 1) return 1;
  return Math.min(4, Math.max(1, Math.floor(cores) - 1));
}
