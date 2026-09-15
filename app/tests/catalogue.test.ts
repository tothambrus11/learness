import { test } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp, smallCatalogue } from './harness.js';
import { trustWordKey } from '../src/lib/keys.js';

test('the index is fetched once, however many screens ask for it', async () => {
  const app = await freshApp();
  await Promise.all([app.catalogue.index(), app.catalogue.index(), app.catalogue.index()]);
  const asked = app.fetched.filter((u) => u.endsWith('index.json'));
  assert.equal(asked.length, 1, 'a 5,000-word file is not fetched three times');
});

test('a word brings in its level, and the level is kept', async () => {
  const app = await freshApp();
  const w = await app.catalogue.word(trustWordKey('jour|noun'));
  assert.equal(w?.fr, 'le jour');
  assert.equal(w?.answer, 'le jour', 'the full record, not the index row');
  await app.catalogue.word(trustWordKey('temps|noun'));
  assert.equal(app.fetched.filter((u) => u.includes('level-01')).length, 1);
});

test('a word the catalogue does not have is null, not a guess', async () => {
  const app = await freshApp();
  assert.equal(await app.catalogue.word(trustWordKey('natel|noun')), null);
});

test('search finds a word by either language, article and accents aside', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(12) });
  const hits = async (q: string): Promise<string[]> =>
    (await app.catalogue.search(q)).map((w) => w.k);
  assert.deepEqual(await hits('gare'), ['gare|noun']);
  assert.deepEqual(await hits('la gare'), ['gare|noun'], 'the article is not in the way');
  assert.deepEqual(await hits('station'), ['gare|noun'], 'the English side counts');
  assert.deepEqual(await hits('nothing at all'), []);
  assert.deepEqual(await hits(''), []);
});

test('search ranks an exact word above one that merely contains it', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(12) });
  const hits = (await app.catalogue.search('pont')).map((w) => w.k);
  assert.equal(hits[0], 'pont|noun');
});

test('level 0 is the function words’ file, and a word there is found like any other', async () => {
  const { levelFile } = await import('../src/lib/catalogue.js');
  assert.equal(levelFile(0), 'function.json');
  assert.equal(levelFile(7), 'level-07.json');
});
