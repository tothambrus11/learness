import { test } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp, smallCatalogue } from './harness.js';
import { trustWordKey } from '../src/lib/keys.js';

test('a word the catalogue already has is promoted, with its audio', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { record, promoted } = await app.words.addWord({ fr: 'le jour', en: ['day'] });
  assert.equal(promoted, true, 'the catalogue knows it');
  assert.equal(record.k, 'jour|noun');
  assert.equal(record.source, 'catalogue');

  const cards = await app.db.allCards();
  assert.deepEqual(cards.map((c) => c.key), ['jour|noun'], 'and it has a card now, not in a week');
  assert.ok(cards[0]?.lesson, 'which puts it before the mined words');
});

test('a word the catalogue lacks is studied from what you typed', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { record, promoted } = await app.words.addWord(
    { fr: 'natel', en: ['mobile phone'], pos: 'noun', gender: 'm' });
  assert.equal(promoted, false);
  assert.equal(record.k, 'natel|noun');
  const shown = await app.words.anyWord(record.k);
  assert.equal(shown?.fr, 'le natel', 'shown the way the catalogue shows every noun');
  assert.equal(shown?.user, true);
});

test('correcting a word keeps its key, so its history stays attached', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { record } = await app.words.addWord({ fr: 'une erreur', en: ['mistake'], pos: 'noun' });
  const before = await app.db.allCards();

  const fixed = await app.words.editWord(record.k, { fr: "l'erreur", gender: 'f' });
  assert.equal(fixed?.k, record.k, 'the same word');
  const after = await app.db.allCards();
  assert.deepEqual(after.map((c) => c.id), before.map((c) => c.id), 'and the same cards');
  assert.equal((await app.words.anyWord(record.k))?.fr, "l'erreur");
});

test('your correction sits on top of the catalogue’s record', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { record } = await app.words.addWord({ fr: 'le temps', en: ['time'] });
  await app.words.editWord(record.k, { gender: 'f', en: ['nought'] });
  const shown = await app.words.anyWord(record.k);
  assert.equal(shown?.gender, 'f', 'yours wins');
  assert.deepEqual(shown?.en, ['nought']);
  assert.equal(shown?.lvl, 1, 'and the catalogue keeps what you did not touch');
});

test('removing a word leaves a tombstone, so the deletion travels', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { record } = await app.words.addWord({ fr: 'natel', en: ['phone'], pos: 'noun' });
  await app.words.removeWord(record.k);
  const rows = await app.db.userWords();
  assert.equal(rows[0]?.deleted, true);
  assert.deepEqual(await app.words.activeUserWords(), [], 'gone from the list');
  assert.deepEqual(await app.db.allCards(), [], 'and its cards with it, being yours alone');
});

test('a word that arrives by sync gets its card on first sight', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  await app.db.putUserWord({ k: trustWordKey('natel|noun'), fr: 'le natel', en: ['phone'],
    pos: 'noun' });
  assert.deepEqual(await app.db.allCards(), [], 'nothing yet');
  const made = await app.words.ensureCards(await app.db.allCards());
  assert.deepEqual(made.map((c) => c.key), ['natel|noun']);
  assert.equal((await app.db.allCards()).length, 1);
});

test('a pasted lesson becomes words, in the order they were pasted', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const added = await app.words.addLessonText('le temps = time\nnatel = mobile phone', 'Tuesday');
  assert.equal(added.length, 2);
  assert.deepEqual(added.map((a) => a.promoted), [true, false]);
  assert.deepEqual((await app.db.lessons()).map((l) => l.label), ['Tuesday']);
});

test('where each of your words stands is read off its card', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { record } = await app.words.addWord({ fr: 'natel', en: ['phone'], pos: 'noun' });
  const cards = await app.db.allCards();
  assert.equal(app.words.statusOf(record.k, cards), 'up next');
  assert.equal(app.words.statusOf(trustWordKey('nothing|noun'), cards), 'not started');
});

test('a word handed over by a screen is stored, proxy and all', async () => {
  /* What a Svelte screen holds is a reactive proxy, and IndexedDB's structured
     clone cannot copy one: adding a word from the dictionary failed with
     "DataCloneError: [object Array] could not be cloned", which reached the
     learner as an Add button that did nothing. */
  const app = await freshApp();
  const proxied = new Proxy(['sock'], {});
  await app.words.addWord({ fr: 'la chaussette', en: proxied, pos: 'noun', gender: 'f',
    own: true });
  const stored = await app.words.activeUserWords();
  assert.deepEqual(stored.map((w) => [w.fr, w.en.join()]), [['la chaussette', 'sock']]);
});
