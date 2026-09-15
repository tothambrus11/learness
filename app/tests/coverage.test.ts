import { test } from 'vitest';
import assert from 'node:assert/strict';
import { coverageOf } from '../src/lib/coverage.js';
import { emptyCard, State } from '../src/lib/scheduler.js';
import type { Rung } from '../src/lib/keys.js';
import { card, entry, k } from './make.js';

const mature = (key: string, rung: Rung = 'recognise') =>
  card(key, 'written', rung, { state: State.Review, stability: 40, reps: 6 });
const answered = (key: string, rung: Rung = 'say') =>
  card(key, 'written', rung, { state: State.Learning, stability: 1, reps: 1 });

const index = [
  entry({ k: 'être|verb', lvl: 1, m: 0.04, looks: 0.2 }),
  entry({ k: 'avoir|verb', lvl: 1, m: 0.03, looks: 0.6 }),
  entry({ k: 'table|noun', lvl: 2, m: 0.001, looks: 1.0 }),
  entry({ k: 'nation|noun', lvl: 2, m: 0.002, looks: 1.0 }),
];

test('an opaque word counts as readable only once its written card is mature', () => {
  const cards = [mature('être|verb'), answered('avoir|verb', 'recognise')];
  const c = coverageOf(cards, index);
  assert.equal(c.known, 1);
  assert.ok(Math.abs(c.share - 0.04) < 1e-9);
});

test('a word that reads as English counts from its first answer, not from being introduced', () => {
  const shownOnly = emptyCard(k('table|noun'), 'written', 'say');    /* reps 0 */
  const once = answered('nation|noun');
  const c = coverageOf([shownOnly, once], index);
  assert.equal(c.known, 1, 'nation, answered once; table only shown');
  assert.ok(Math.abs(c.share - 0.002) < 1e-9);
});

test('a heard card is not a known word', () => {
  const heard = { ...emptyCard(k('être|verb'), 'heard', 'hear'), state: State.Review, stability: 40 };
  assert.equal(coverageOf([heard], index).known, 0);
});

test('"can use" needs the written card mature at write it or above', () => {
  const c = coverageOf([mature('être|verb', 'recognise'), mature('avoir|verb', 'write')], index);
  assert.equal(c.known, 2);
  assert.equal(c.usable, 1);
  assert.ok(Math.abs(c.use - 0.03) < 1e-9);
});

test('a retired lower rung still counts for what it proved', () => {
  const retired = { ...mature('être|verb', 'recognise'), retired: true };
  const next = emptyCard(k('être|verb'), 'written', 'say');
  assert.equal(coverageOf([retired, next], index).known, 1);
});

test('levels report started and known', () => {
  const c = coverageOf([mature('être|verb'), emptyCard(k('avoir|verb'), 'written', 'recognise')], index);
  assert.deepEqual(c.levels, [
    { level: 1, total: 2, started: 2, known: 1 },
    { level: 2, total: 2, started: 0, known: 0 },
  ]);
});

test('an index without mass still counts words', () => {
  const c = coverageOf([mature('x|noun')], [entry({ k: 'x|noun', lvl: 3, m: 0 })]);
  assert.equal(c.known, 1);
  assert.equal(c.share, 0);
});

test('function words are counted apart, and weigh nothing in the share', () => {
  /* They carry no mass on purpose: the share counts inflections of ranked
     words and cannot be gamed, and admitting forty words with a sixth of the
     text between them would have made it leap the first week. */
  const withFunction = [...index, entry({ k: 'sur|prep', fr: 'sur', en: ['on'], lvl: 0, m: 0, kind: 'function' }),
    entry({ k: 'dans|prep', fr: 'dans', en: ['in'], lvl: 0, m: 0, kind: 'function' })];
  const known = card('sur|prep', 'sense', 'fill', { state: State.Review, stability: 40, reps: 6 });
  const met = card('dans|prep', 'sense', 'meet', { reps: 1 });
  const c = coverageOf([known, met, mature('être|verb')], withFunction);
  assert.deepEqual(c.functionWords, { total: 2, known: 1 });
  assert.equal(c.known, 1, 'sur is not a catalogue word you can read');
  assert.ok(Math.abs(c.share - 0.04) < 1e-9);
  assert.equal(c.levels.some((l) => l.level === 0), false, 'level 0 is not a level');
});
