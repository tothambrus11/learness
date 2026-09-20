/** The one shuffle: the same seed gives the same order, every element once. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { orderedBy } from '../src/lib/shuffle.js';

test('an order depends on the seed alone, holds every index once, and moves with the seed', () => {
  assert.deepEqual(orderedBy(3, 7), orderedBy(3, 7));
  assert.deepEqual([...orderedBy(5, 3)].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  const seen = new Set([0, 1, 2, 3, 4, 5].map((s) => orderedBy(3, s).join('')));
  assert.ok(seen.size > 1, 'different seeds, different orders');
  assert.deepEqual(orderedBy(0, 1), []);
  assert.deepEqual(orderedBy(1, 9), [0]);
});
