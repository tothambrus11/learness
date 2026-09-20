/** The one shuffle in the app, and it takes a seed.
 *
 *  A sitting is dealt without dice (tests/rules.test.ts): the same records
 *  deal the same cards on every device and every open, so anything that
 *  needs an order that is not the obvious one — the buttons of a tap card,
 *  the verb a drill lands on — takes it from here, seeded by something the
 *  records give, and gets it back the same way next time. Pure, so the
 *  Worker can import it as it imports the rest of the rules.
 */

/** The numbers 0 to n−1 in an order that depends on the seed alone: the
 *  same seed gives the same order on every device. A card's buttons are
 *  in the same places when it is looked back at, and in different places
 *  the next time it is dealt. A shuffle from Math.random did neither. */
export function orderedBy(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  let x = (seed * 2654435761 + 12345) >>> 0;
  for (let i = n - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
