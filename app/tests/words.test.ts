import { test } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp, smallCatalogue } from './harness.js';
import { trustWordKey } from '../src/lib/keys.js';
import type { UserWord } from '../src/lib/model.js';

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

test('a catalogue word corrected from its card joins your list, corrected', async () => {
  /* Most of what a sitting deals is the catalogue's, in no list at all, and
     the catalogue is read-only: a correction has nowhere to live until the
     word is yours. So it is put in your list under the catalogue's own key,
     the way promoting it would, with the correction laid on top. */
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  assert.deepEqual(await app.words.activeUserWords(), []);
  const key = trustWordKey('temps|noun');
  const rec = await app.words.correctWord(key, { en: ['weather'] });
  assert.equal(rec?.k, key);
  assert.equal(rec?.source, 'catalogue');
  const shown = await app.words.anyWord(key);
  assert.deepEqual(shown?.en, ['weather']);
  assert.equal(shown?.fr, 'le temps', 'the catalogue keeps what you did not touch');
  assert.equal(shown?.lvl, 1);
  /* Corrected again, it is the record it now has that changes. */
  await app.words.correctWord(key, { gender: 'f' });
  assert.equal((await app.words.activeUserWords()).length, 1);
  assert.equal((await app.words.anyWord(key))?.gender, 'f');
  assert.deepEqual((await app.words.anyWord(key))?.en, ['weather']);
  assert.equal(await app.words.correctWord(trustWordKey('nothing|noun'), { en: ['x'] }), null,
    'a key nothing knows');
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

test('a word whose translations were stored as a string keeps them', async () => {
  /* Rows written by an older version and by the MCP server hold `en` as a
     string, which `toStudyWord` and the list both still read. Copying it as if
     it were an array would store a word whose translations are its letters. */
  const app = await freshApp();
  await app.db.putUserWord({ k: trustWordKey('la caisse|noun'), fr: 'la caisse',
    en: 'till, checkout' as unknown as UserWord['en'], pos: 'noun', source: 'app' });
  const [stored] = await app.words.activeUserWords();
  assert.ok(stored);
  assert.equal(stored.en, 'till, checkout', 'exactly what was handed over');
  assert.deepEqual(app.words.toStudyWord(stored).en, ['till', 'checkout'],
    'and the card still reads it');
});

test('a word handed over by a screen is stored, proxy and all', async () => {
  /* What a Svelte screen holds is a reactive proxy, and IndexedDB's structured
     clone cannot copy one: adding a word from the dictionary failed with
     "DataCloneError: [object Array] could not be cloned", which reached the
     learner as an Add button that did nothing. */
  const app = await freshApp();
  const proxied = new Proxy(['sock'], {});
  await app.words.addWord({ fr: 'la chaussette', en: proxied, pos: 'noun', gender: 'f',
    ipa: '/ʃo.sɛt/', own: true });
  const stored = await app.words.activeUserWords();
  assert.deepEqual(stored.map((w) => [w.fr, w.en.join()]), [['la chaussette', 'sock']]);
  assert.equal(app.words.toStudyWord(stored[0]!).ipa, '/ʃo.sɛt/',
    'and what the dictionary knew about how it is said is on the card');
});
