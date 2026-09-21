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
import { choiceFor, cueOf, face, senses, sentenceFor } from '../src/lib/cardface.js';
import { phrasesOf } from '../src/lib/conjspeech.js';
import { coverageOf } from '../src/lib/coverage.js';
import { entryChannel, entryRung } from '../src/lib/ladder.js';
import type { CatalogueMeta } from '../src/lib/catalogue.js';
import type { DictEntry } from '../src/lib/dictionary.js';
import type { IndexEntry, StudyWord } from '../src/lib/model.js';
import { freshApp } from './harness.js';
import { card, words } from './make.js';

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
  assert.equal(meta.words + (meta.functionWords ?? 0), index.length);
  assert.equal(meta.levels.length, 1);
  assert.equal(meta.recipe, 'fixture', 'the catalogue says what it was made from, not when');
  const rung = (key: string): string =>
    entryRung('written', index.find((e) => e.k === key) ?? null);
  assert.equal(rung('nation|noun'), 'write', 'a word that reads as English starts by being written');
  assert.equal(rung('train|noun'), 'write');
  assert.equal(rung('pont|noun'), 'recognise');
  assert.equal(rung('parler|verb'), 'recognise');
  /* A function word has no score to enter by: it starts on the sense channel,
     at the meeting, and its full record is in function.json, not a level. */
  const sur = index.find((e) => e.k === 'sur|prep');
  assert.equal(sur?.kind, 'function');
  assert.equal(sur?.lvl, 0);
  assert.equal(entryChannel(sur ?? null), 'sense');
  assert.equal(entryRung('sense', sur ?? null), 'meet');
});

const functionWords = load<{ words: StudyWord[] }>('function.json').words;

test('a function word’s file carries a sense, its partners and its sentences', () => {
  const sur = functionWords.find((w) => w.k === 'sur|prep');
  assert.ok(sur);
  assert.equal(sur.sense, 'on a surface, resting against it from above');
  assert.deepEqual(sur.contrast, ['sous|prep', 'dans|prep']);
  const item = { kind: 'word' as const, card: card('sur|prep', 'sense', 'choose'), word: sur };
  assert.deepEqual([...(choiceFor(item)?.options ?? [])].sort((a, b) => a.localeCompare(b)),
    ['dans', 'sous', 'sur'], 'the choose card offers the word among its partners');
  assert.ok(face(item, { revealed: false }).some((l) => l.kind === 'options'));
});

test('a level file carries everything a card shows', () => {
  const nation = get('nation|noun');
  const item = { kind: 'word' as const, card: card('nation|noun', 'written', 'write'), word: nation };
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
  assert.equal(typeof parler.conj?.examples?.pres?.[0]?.id, 'number',
    'and the sentence carries the corpus\'s own id, which a learner\'s history is kept by');
  assert.equal(typeof parler.ex?.[0]?.id, 'number', 'as does a sentence for the cloze rung');
  const item = { kind: 'word' as const, card: card('parler|verb', 'written', 'use'), word: parler };
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
  const app = await freshApp({ catalogue: { index, words: level, functionWords } });
  await app.db.setSetting('maxNewPerDay', 9);
  const built = await app.session.buildSession();
  const items = words(built.items);
  assert.equal(items.length, 9);
  assert.deepEqual(items.map((it) => it.card.key).sort(),
    index.map((e) => e.k).sort(), 'every word, once, the function words included');
  assert.equal(items.find((it) => it.card.key === 'dans|prep')?.card.rung, 'meet');
  const nation = items.find((it) => it.card.key === 'nation|noun');
  assert.equal(nation?.card.rung, 'write');
  assert.equal(nation?.word.ipa, '/na.sjɔ̃/', 'the level file was fetched and read');
  const cards = items.map((it) => it.card);
  assert.equal(coverageOf(cards, index).known, 0, 'nothing known yet');
});

test('the dictionary the words screen fills a form from is the pipeline’s own', async () => {
  /* Its shards are what the app asks for by name, so the name is the contract:
     `webexport.dict_shard` and `shardOf` have to agree, letter for letter. */
  const { shardOf } = await import('../src/lib/dictionary.js');
  assert.ok(meta.dictionary, 'the fixture catalogue ships one');
  assert.deepEqual(meta.dictionary?.letters, ['c', 'p', 'u']);
  assert.equal(meta.dictionary?.words, 3);
  for (const letter of meta.dictionary?.letters ?? []) {
    const shard = load<{ letter: string; words: DictEntry[] }>(`dict-${letter}.json`);
    assert.equal(shard.letter, letter);
    for (const w of shard.words) {
      assert.equal(shardOf(w.fr), letter, `${w.fr} is asked for from dict-${letter}.json`);
      assert.ok(w.en.length && w.pos, 'a word a form can be filled in from');
    }
  }
  /* "l'un" is filed under u: the app strips the article from what was typed
     before it picks a file, so a headword that is written with one has to be
     filed under the word. The loop above is what checks that, letter by
     letter — it failed here first, on a word written to l and looked for in
     u. */
  assert.deepEqual(load<{ words: DictEntry[] }>('dict-u.json').words.map((w) => w.fr), ["l'un"]);
  const sock = load<{ words: DictEntry[] }>('dict-c.json').words[0];
  assert.deepEqual(sock, { fr: 'la chaussette', en: ['sock'], pos: 'noun', gender: 'f',
    ipa: '/ʃo.sɛt/' });
  assert.equal(index.some((e) => e.k === 'jour|noun'), true);
  assert.equal(meta.dictionary?.letters.includes('j'), false,
    'a word the catalogue teaches is offered from there, never from both');
});

test('a verb’s file carries what it governs, as the pipeline’s hand-list says', () => {
  /* The chunk is written in frcog/function.py and read on the back of the
     card: two spellings of one field, pinned from both sides. */
  const parler = level.find((w) => w.k === 'parler|verb');
  assert.deepEqual(parler?.chunks, [
    { fr: 'parler de qch', en: 'to talk about something' },
    { fr: 'parler à qn', en: 'to talk to someone' },
  ]);
  assert.equal('chunks' in (level.find((w) => w.k === 'nation|noun') ?? {}), false, 'absent where none');
});

test('the grammar’s generators run over the pipeline’s own verb, and every label names a rule', async () => {
  const { instancesFor } = await import('../src/lib/grammar/deal.js');
  const { isRuleId } = await import('../src/lib/grammar/rules.js');
  const { parseItemRef } = await import('../src/lib/grammar/grade.js');
  const parler = get('parler|verb');
  const made = instancesFor(parler);
  const ids = made.map((i) => i.id);
  assert.deepEqual(ids.filter((id) => !/^(form|say|order|mark):/.test(id)
    && !id.endsWith(':V.pc-vs-imp')), ['table:parler|verb:pres',
    'sentence:parler|verb:1001:G.pas', 'sentence:parler|verb:1001:G.others', 'sentence:parler|verb:1001:Q.yes-no'],
    'a table, and the one présent sentence with its corpus id, for each rule that handles it');
  assert.deepEqual(ids.filter((id) => id.endsWith(':V.pc-vs-imp')),
    ['sentence:parler|verb:1002:V.pc-vs-imp', 'sentence:parler|verb:1003:V.pc-vs-imp'], 'the pc and imp sentences, to tell apart');
  assert.ok(ids.includes('order:parler|verb:G.pas-infinitive') && ids.includes('mark:parler|verb:P.verb-endings'));
  assert.equal(ids.filter((id) => id.startsWith('form:parler|verb:pres:')).length, 6, 'and the table’s six forms');
  const by = (id: string) => made.find((i) => i.id === id);
  assert.equal(by('sentence:parler|verb:1001:G.pas')?.cells[0]?.expected, 'Nous ne parlons pas français.');
  assert.equal(by('sentence:parler|verb:1001:Q.yes-no')?.cells[0]?.expected, 'Est-ce que nous parlons français ?');
  for (const i of made) {
    for (const c of i.cells) {
      for (const o of c.obs) assert.ok(isRuleId(o.of) || parseItemRef(o.of), `${i.id}: ${o.of}`);
    }
  }
});
