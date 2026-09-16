/** Reading the shipped catalogue through the assets binding.
 *
 *  The fixture is the pipeline's own export, so what the server reads here
 *  is exactly what it will read on the edge.
 */
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { catalogueOf, forgetCatalogue } from '../src/catalogue.js';
import { harness, ORIGIN } from './env.js';

beforeEach(() => forgetCatalogue());

test('the index and a dictionary letter are read as the pipeline wrote them', async () => {
  const c = catalogueOf(harness().env.ASSETS, ORIGIN);
  const index = await c.index();
  assert.ok(index && index.some((w) => w.k === 'train|noun'));
  const cs = await c.dictionary('c');
  assert.deepEqual(cs?.map((w) => w.fr), ['la chaussette']);
  assert.deepEqual(await c.dictionary('z'), [], 'a letter with no file has no words');
});

test('a catalogue that cannot be read is null, not empty, and is tried again', async () => {
  let fail = true;
  const real = harness().env.ASSETS;
  const flaky = { fetch: async (input: RequestInfo | URL) =>
    fail ? new Response('gone', { status: 503 }) : real.fetch(input) };
  const c = catalogueOf(flaky, ORIGIN);
  assert.equal(await c.index(), null);
  assert.equal(await c.dictionary('c'), null, 'no meta, so no dictionary');
  fail = false;
  assert.ok(await c.index(), 'the failure was not remembered');
});

test('no assets binding at all reads as nothing, without throwing', async () => {
  const c = catalogueOf(undefined, ORIGIN);
  assert.equal(await c.index(), null);
  assert.equal(await c.meta(), null);
});
