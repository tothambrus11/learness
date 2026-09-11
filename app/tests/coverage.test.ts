/** The headline numbers: what counts as readable, and what counts as usable. */
import { expect, test } from 'vitest';

import { coverageOf } from '../src/lib/coverage';
import { emptyCard, State } from '../src/lib/scheduler';
import type { Card, CatalogueEntry, Rung, WordKey } from '../src/lib/types';

/** A written card whose memory is long enough to call the word known. */
const mature = (key: WordKey, rung: Rung = 'recognise'): Card => ({
  ...emptyCard(key, 'written', rung),
  state: State.Review,
  stability: 40,
  reps: 6,
});

/** A written card answered once: met and got right, but not yet known. */
const answered = (key: WordKey, rung: Rung = 'say'): Card => ({
  ...emptyCard(key, 'written', rung),
  state: State.Learning,
  stability: 1,
  reps: 1,
});

/** One row of the shipped index. Only the key, the level, the spelling
 *  similarity and the frequency mass are read here; `m` defaults to 0, which
 *  is how an index that carries no mass at all already reads. */
const entry = (
  k: WordKey,
  lvl: number,
  over: Partial<CatalogueEntry> = {},
): CatalogueEntry => ({ k, fr: k.split('|')[0], en: [], lvl, m: 0, ...over });

/** Four catalogue words: two opaque ones in level 1, two that read as English
 *  in level 2. */
const index: CatalogueEntry[] = [
  entry('être|verb', 1, { m: 0.04, looks: 0.2 }),
  entry('avoir|verb', 1, { m: 0.03, looks: 0.6 }),
  entry('table|noun', 2, { m: 0.001, looks: 1.0 }),
  entry('nation|noun', 2, { m: 0.002, looks: 1.0 }),
];

test('an opaque word counts as readable only once its written card is mature', () => {
  const cards = [mature('être|verb'), answered('avoir|verb', 'recognise')];
  const c = coverageOf(cards, index);
  expect(c.known).toBe(1);
  expect(Math.abs(c.share - 0.04) < 1e-9).toBeTruthy();
});

test('a word that reads as English counts from its first answer, not from being introduced', () => {
  const shownOnly = emptyCard('table|noun', 'written', 'say'); /* reps 0 */
  const once = answered('nation|noun');
  const c = coverageOf([shownOnly, once], index);
  expect(c.known, 'nation, answered once; table only shown').toBe(1);
  expect(Math.abs(c.share - 0.002) < 1e-9).toBeTruthy();
});

test('a heard card is not a known word', () => {
  const heard = {
    ...emptyCard('être|verb', 'heard', 'hear'),
    state: State.Review,
    stability: 40,
  };
  expect(coverageOf([heard], index).known).toBe(0);
});

test('"can use" needs the written card mature at write it or above', () => {
  const c = coverageOf(
    [mature('être|verb', 'recognise'), mature('avoir|verb', 'write')],
    index,
  );
  expect(c.known).toBe(2);
  expect(c.usable).toBe(1);
  expect(Math.abs(c.use - 0.03) < 1e-9).toBeTruthy();
});

test('a retired lower rung still counts for what it proved', () => {
  const retired = { ...mature('être|verb', 'recognise'), retired: true };
  const next = emptyCard('être|verb', 'written', 'say');
  expect(coverageOf([retired, next], index).known).toBe(1);
});

test('levels report started and known', () => {
  const c = coverageOf(
    [mature('être|verb'), emptyCard('avoir|verb', 'written', 'recognise')],
    index,
  );
  expect(c.levels).toEqual([
    { level: 1, total: 2, started: 2, known: 1 },
    { level: 2, total: 2, started: 0, known: 0 },
  ]);
});

test('an index without mass still counts words', () => {
  const c = coverageOf([mature('x|noun')], [entry('x|noun', 3)]);
  expect(c.known).toBe(1);
  expect(c.share).toBe(0);
});
