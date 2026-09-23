/** A word's page shows the word whole, as the card would show it.
 *
 *  The list is a line per word and the card is what a rung asks; the page
 *  is where a word is read entire (#42). What it shows is data from
 *  worddetail.ts, worked out from the same records the card resolves — so
 *  a correction shows here as it does on the card, and a word the catalogue
 *  does not teach is read from the dictionary in the shape it would take
 *  once added.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { detailHref, detailOf, fromDictionary } from '../src/lib/worddetail.js';
import { freshApp, smallCatalogue } from './harness.js';
import { card, k, review, word } from './make.js';
import { State } from '../src/lib/scheduler.js';

const bug = word({
  k: 'bug|noun', fr: 'le bug', answer: 'le bug', lemma: 'bug', gender: 'm', ipa: '/bœɡ/',
  en: ['bug', 'insect', 'glitch'], lvl: 3, pos: 'noun',
  ex: [{ fr: 'Il y a un bug dans le code.', f: 'bug', en: 'There is a bug in the code.' },
    { fr: 'Le débug-bug est là.', f: 'bug', en: 'Not a sentence about the word.' }],
  def: { fr: ['Défaut dans un programme.'], en: ['bug', 'a fault in a program'] },
  chunks: [{ fr: 'buguer sur qch', en: 'to crash on something' }],
  conj: { lemma: 'buguer', aux: 'avoir', shape: '', compound: [], impersonal: [], links: [],
    groups: [{ id: 'pres', mood: '', tense: 'Présent', stem: 'bugu', irregular: false, note: '',
      rows: [{ p: 'je', s: 'bugu', e: 'e', f: 'bugue' }] }], examples: {} },
});

test('the page lays out the word, its senses, its sentences marked, and what it governs', () => {
  const d = detailOf({ word: bug, cards: [], reviews: [], origin: 'catalogue' });
  assert.equal(d.fr, 'le bug');
  assert.equal(d.ipa, '/bœɡ/');
  assert.deepEqual(d.en, ['bug', 'insect', 'glitch'], 'every translation, not the first three');
  assert.deepEqual(d.senses, ['a fault in a program'], 'only what the translations line does not say');
  assert.deepEqual(d.defs, ['Défaut dans un programme.']);
  assert.deepEqual(d.examples[0], { fr: 'Il y a un bug dans le code.', en: 'There is a bug in the code.',
    before: 'Il y a un ', mark: 'bug', after: ' dans le code.' });
  assert.equal(d.examples[1]?.mark, '', 'a sentence the word is not found in is shown unmarked');
  assert.deepEqual(d.chunks, [{ fr: 'buguer sur qch', en: 'to crash on something' }]);
  assert.equal(d.hasForms, true);
  assert.equal(d.little, false);
  assert.equal('level' in d, false,
    'the catalogue\'s level is not the page\'s to show: a number that means nothing to the learner (#75)');
  assert.equal(d.status, 'not started');
  assert.deepEqual(d.ladders, [], 'no cards: nothing to report');
});

test('each channel the word is open on is a ladder with its rung, its state and its next date', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const written = card('bug|noun', 'written', 'say', { state: State.Review, stability: 12, reps: 5,
    due: new Date('2026-09-17T12:00:00Z') });
  const heard = card('bug|noun', 'heard', 'hear', { state: State.New, reps: 0,
    due: new Date('2026-09-15T00:00:00Z') });
  const other = card('cafard|noun', 'written', 'write');
  const reviews = [
    review({ id: written.id, key: 'bug|noun', rating: 3 }), review({ id: written.id, key: 'bug|noun', rating: 1 }),
    review({ id: other.id, key: 'cafard|noun', rating: 3 }),
  ];
  const d = detailOf({ word: bug, cards: [written, heard, other], reviews, origin: 'catalogue', now });
  assert.deepEqual(d.ladders.map((l) => [l.channel, l.rung, l.step, l.of, l.state, l.due, l.accuracy, l.answers]), [
    ['written', 'say', 2, 4, 'review', 'due in 2 d', 0.5, 2],
    ['heard', 'hear', 1, 2, 'new', 'due now', null, 0],
  ], 'in channel order, and only this word’s cards');
  assert.equal(d.ladders[0]?.label, 'Written');
  assert.equal(d.status, 'learning', 'as the words list would say it');
});

test('a function word’s page carries its sense, its partners by name, and its status from the sense channel', () => {
  const sur = word({ k: 'sur|prep', fr: 'sur', answer: 'sur', lemma: 'sur', pos: 'prep', lvl: 0,
    en: ['on', 'about'], kind: 'function', sense: 'on a surface', contrast: [k('sous|prep'), k('dans|prep')] });
  const met = card('sur|prep', 'sense', 'meet', { state: State.New });
  const d = detailOf({ word: sur, cards: [met], reviews: [], origin: 'catalogue' });
  assert.equal(d.sense, 'on a surface');
  assert.equal(d.little, true);
  assert.deepEqual(d.contrast, [{ key: 'sous|prep', fr: 'sous' }, { key: 'dans|prep', fr: 'dans' }]);
  assert.equal(d.status, 'up next', 'read off the sense card, which is the only one it has');
  assert.equal(d.ladders[0]?.label, 'In a sentence');
});

test('a dictionary entry becomes the record a word added from it would be', () => {
  const w = fromDictionary({ fr: 'la chaussette', en: ['sock'], pos: 'noun', gender: 'f', ipa: '/ʃo.sɛt/' });
  assert.equal(w.k, 'la chaussette|noun');
  assert.equal(w.fr, 'la chaussette');
  assert.equal(w.ipa, '/ʃo.sɛt/');
  assert.equal(w.user, true);
  assert.equal(fromDictionary({ fr: 'plonger', en: ['to dive'], pos: 'verb' }).ipa, '', 'none is none');
});

test('the address of a word’s page is spelt one way, base and all', () => {
  assert.equal(detailHref('', k('bug|noun')), '/word/?k=bug%7Cnoun');
  assert.equal(detailHref('/app', k('le bus|noun')), '/app/word/?k=le%20bus%7Cnoun');
});

test('a word set aside from a card says so on its page, and its ladders are still there', async () => {
  const d = detailOf({ word: bug, cards: [card('bug|noun', 'written', 'say', { reps: 3 })], reviews: [],
    origin: 'catalogue', skipped: true });
  assert.equal(d.status, 'skipped', 'what the learner did, over what the card says (#99)');
  assert.equal(d.ladders.length, 1, 'the cards were kept');
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { loadDetail } = await import('../src/lib/worddetail.js');
  await app.words.skipWord(k('temps|noun'));
  assert.equal((await loadDetail(k('temps|noun')))?.detail.status, 'skipped', 'read off the record');
});

test('the page resolves a word the way the card does, and knows nothing about a key nobody has', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const { loadDetail } = await import('../src/lib/worddetail.js');
  const { record } = await app.words.addWord({ fr: 'le temps', en: ['time'] });
  await app.words.editWord(record.k, { gender: 'f' });
  const found = await loadDetail(record.k);
  assert.ok(found);
  assert.equal(found.detail.origin, 'catalogue');
  assert.equal(found.detail.gender, 'f', 'the correction, over the catalogue’s record');
  assert.equal(found.detail.status, 'up next');
  assert.equal(found.detail.ladders.length, 1);
  assert.equal(found.word.k, record.k, 'the record comes back with it');
  const mine = await app.words.addWord({ fr: 'natel', en: ['mobile'], pos: 'noun', gender: 'm' });
  assert.equal((await loadDetail(mine.record.k))?.detail.origin, 'mine');
  assert.equal(await loadDetail(k('nothing|noun')), null);
});
