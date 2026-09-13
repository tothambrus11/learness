/** The catalogue as the pipeline actually writes it, read by the app as it
 *  actually reads it.
 *
 *  tests/fixtures/catalogue/ at the repository root is one small catalogue
 *  exported by frcog.webexport from a seeded database, checked in, and
 *  compared against a fresh export by tests/test_webexport.py. Here the same
 *  files are the harness's catalogue, and the app's own readers are driven
 *  over them: which rung a word enters on, what its card shows, what its
 *  verb table says, where its sound comes from. A field renamed on either
 *  side fails here and there with the same file in the message — which is
 *  the only way anything would notice, there being no schema between the two
 *  languages.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cueOf, face, senses, sentenceFor } from '../src/lib/cardface.js';
import { phrasesOf } from '../src/lib/conjspeech.js';
import { coverageOf } from '../src/lib/coverage.js';
import { entryRung } from '../src/lib/ladder.js';
import type { CatalogueMeta } from '../src/lib/catalogue.js';
import type { IndexEntry, StudyWord } from '../src/lib/model.js';
import { freshApp } from './harness.js';
import { card } from './make.js';

const DIR = fileURLToPath(new URL('../../tests/fixtures/catalogue/', import.meta.url));
/* Shipped JSON is trusted to be the shape the pipeline writes, and that trust
   is spent here the way catalogue.ts spends it: once, at the boundary. */
const load = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}${name}`, 'utf8')) as T;
const meta = load<CatalogueMeta>('meta.json');
const index = load<{ words: IndexEntry[] }>('index.json').words;
const level = load<{ words: StudyWord[] }>('level-01.json').words;
const byKey = new Map(level.map((w) => [w.k, w]));
const get = (key: string): StudyWord => {
  const w = byKey.get(key as StudyWord['k']);
  assert.ok(w, `${key} is in the fixture`);
  return w;
};

test('the index says where each word enters the ladder', () => {
  assert.equal(meta.words, index.length);
  assert.equal(meta.levels.length, 1);
  const rung = (key: string): string =>
    entryRung('written', index.find((e) => e.k === key) ?? null);
  assert.equal(rung('nation|noun'), 'write', 'a word that reads as English starts by being written');
  assert.equal(rung('train|noun'), 'write');
  assert.equal(rung('pont|noun'), 'recognise');
  assert.equal(rung('parler|verb'), 'recognise');
});

test('a level file carries everything a card shows', () => {
  const nation = get('nation|noun');
  const item = { card: card('nation|noun', 'written', 'write'), word: nation };
  const back = face(item, { revealed: true });
  assert.ok(back.some((l) => l.kind === 'answer-fr' && l.text === 'la nation' && l.gender === 'f'));
  assert.ok(back.some((l) => l.kind === 'ipa' && l.text === '/na.sjɔ̃/'));
  assert.ok(back.some((l) => l.kind === 'hint' && l.text === 'noun, f'));
  assert.equal(cueOf(nation), 'nation');
  assert.deepEqual(senses(nation), [], 'one translation, already the answer');
  assert.deepEqual(nation.def?.fr, ['Communauté humaine établie sur un territoire.']);
});

test('a verb’s table speaks, and its sentences are where the app looks for them', () => {
  const parler = get('parler|verb');
  assert.deepEqual(phrasesOf(parler.k, parler.conj, ['pres']).map((p) => p.text),
    ['je parle', 'tu parles', 'il parle', 'nous parlons', 'vous parlez', 'ils parlent']);
  assert.deepEqual(parler.conj?.examples?.pres?.[0]?.f, 'parlons', 'a line of the table with a sentence');
  const item = { card: card('parler|verb', 'written', 'use'), word: parler };
  assert.equal(sentenceFor(item)?.f, 'parle', 'the form the cloze rung blanks');
  const front = face(item, { revealed: false });
  assert.ok(front.some((l) => l.kind === 'sentence' && l.before === 'Il ' && l.after === ' trop vite.'));
});

test('the recordings are named, and a missing one is named too', async () => {
  const app = await freshApp({ catalogue: { index, words: level } });
  const { srcFor } = await import('../src/lib/audio.js');
  assert.equal(await srcFor(get('nation|noun'), 'fr'), '/media/w1.mp3');
  assert.equal(await srcFor(get('nation|noun'), 'en'), '/media/w1-en.mp3');
  assert.equal(await srcFor(get('oubli|noun'), 'fr'), '/media/gone.mp3',
    'the app asks for it and the server says no; that is the card’s to report');
  assert.ok(app);
});

test('a sitting is dealt from the pipeline’s own catalogue', async () => {
  const app = await freshApp({ catalogue: { index, words: level } });
  await app.db.setSetting('maxNewPerDay', 6);
  const built = await app.session.buildSession();
  assert.equal(built.items.length, 6);
  assert.deepEqual(built.items.map((it) => it.card.key).sort(),
    index.map((e) => e.k).sort(), 'every word, once');
  const nation = built.items.find((it) => it.card.key === 'nation|noun');
  assert.equal(nation?.card.rung, 'write');
  assert.equal(nation?.word.ipa, '/na.sjɔ̃/', 'the level file was fetched and read');
  const cards = built.items.map((it) => it.card);
  assert.equal(coverageOf(cards, index).known, 0, 'nothing known yet');
});
