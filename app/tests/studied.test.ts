/** The words the learner has studied, as the sheets read them. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp, smallCatalogue } from './harness.js';
import { card, k, userWord } from './make.js';

test('a word is studied once any of its cards has been answered, missed or not', async () => {
  const { studiedKeys } = await import('../src/lib/studied.js');
  const cards = [
    card('chat|noun', 'written', 'recognise', { reps: 1, lapses: 1 }),
    card('chien|noun', 'written', 'recognise'),
    card('chien|noun', 'heard', 'hear', { reps: 2 }),
    card('vélo|noun', 'written', 'recognise'),
    card('aller|verb', 'written', 'recognise', { reps: 3 }),
  ];
  assert.deepEqual(studiedKeys(cards, new Set()), [k('aller|verb'), k('chat|noun'), k('chien|noun')],
    'once each, in key order; vélo was never answered');
  assert.deepEqual(studiedKeys(cards, new Set([k('chat|noun')])), [k('aller|verb'), k('chien|noun')],
    'a word set aside is not offered');
});

test('the studied nouns come back as a card shows them, less the skipped, the removed and the other parts of speech', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(4) });
  const { studiedWords } = await import('../src/lib/studied.js');
  const cat = await app.catalogue.index();
  const [a, b, c] = cat.map((e) => e.k);
  await app.db.putCard(card(a!, 'written', 'recognise', { reps: 1 }));
  await app.db.putCard(card(b!, 'written', 'recognise', { reps: 1 }));
  await app.db.putCard(card(c!, 'written', 'recognise'));
  await app.db.putCard(card('mine|noun', 'written', 'recognise', { reps: 1 }));
  await app.db.putCard(card('gone|noun', 'written', 'recognise', { reps: 1 }));
  await app.db.putCard(card('aller|verb', 'written', 'recognise', { reps: 1 }));
  await app.db.putUserWord(userWord({ k: b!, fr: 'x', skipped: true }));
  await app.db.putUserWord(userWord({ k: 'mine|noun', fr: 'la mine', en: ['mine'], pos: 'noun', gender: 'f' }));
  await app.db.putUserWord(userWord({ k: 'gone|noun', fr: 'le gone', pos: 'noun', deleted: true }));
  const words = await studiedWords('noun');
  assert.deepEqual(words.map((w) => w.k).sort(), [a!, 'mine|noun'].sort());
  assert.equal(words.find((w) => w.k === 'mine|noun')?.fr, 'la mine', 'your own word, with its article');
});
