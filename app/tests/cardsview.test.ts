import { test } from 'vitest';
import { Rating } from 'ts-fsrs';
import assert from 'node:assert/strict';
import { State } from '../src/lib/scheduler.js';
import { dueText, sortRows, stateLabel, strengthBar, summarise, tally } from '../src/lib/cardsview.js';
import type { Channel, Rung, WordKey } from '../src/lib/keys.js';
import type { LadderCard, StudyWord } from '../src/lib/model.js';
import { card as made, id as cardIdOf, review, word } from './make.js';

const now = new Date('2026-03-01T08:00:00Z');
const card = (key: string, channel: Channel, rung: Rung, extra: Partial<LadderCard> = {}):
  LadderCard => made(key, channel, rung, extra, now);
const words: Record<string, StudyWord> = {
  'bug|noun': word({ k: 'bug|noun', fr: 'le bug', en: ['bug'], lvl: 1 }),
  'table|noun': word({ k: 'table|noun', fr: 'la table', en: ['table'], lvl: 1 }),
};
const wordOf = (key: WordKey): StudyWord | undefined => words[key];

const cards = [
  /* bug climbed from recognise to say; the old rung is retired but its lapse counts */
  card('bug|noun', 'written', 'recognise', { state: State.Review, stability: 40, reps: 6, lapses: 1,
    retired: true, due: new Date('2026-03-20'), last_review: new Date('2026-02-10') }),
  card('bug|noun', 'written', 'say', { state: State.Review, stability: 40, difficulty: 4, reps: 6, lapses: 0,
    due: new Date('2026-03-20'), last_review: new Date('2026-02-10') }),
  card('bug|noun', 'heard', 'hear', { state: State.Learning, stability: 2, reps: 1, due: new Date('2026-02-28') }),
  card('table|noun', 'written', 'recognise', { state: State.Relearning, stability: 3, difficulty: 8, reps: 5, lapses: 2,
    due: new Date('2026-03-02'), last_review: new Date('2026-02-28') }),
];
const reviews = [
  review({ id: cardIdOf('bug|noun|written|say'), rating: Rating.Good }),
  review({ id: cardIdOf('bug|noun|written|say'), rating: Rating.Easy }),
  review({ id: cardIdOf('bug|noun|written|say'), rating: Rating.Again }),
  review({ id: cardIdOf('table|noun|written|recognise'), rating: Rating.Again }),
];

test('a word is one row carrying each channel at its live rung', () => {
  const rows = summarise({ cards, reviews, wordOf, now });
  const bug = rows.find((r) => r.key === 'bug|noun');
  assert.equal(bug!.fr, 'le bug');
  assert.deepEqual(bug!.open, ['written', 'heard']);
  assert.equal(bug!.channels.written!.rung, 'say', 'the retired rung is not the live one');
  assert.equal(bug!.strength, 40);
  assert.equal(bug!.label, 'known');
  assert.equal(bug!.lapses, 1, 'a lapse on a retired rung still happened');
  assert.ok(Math.abs((bug!.channels.written!.accuracy ?? 0) - 2 / 3) < 1e-9);
  assert.equal(bug!.channels.heard!.accuracy, null);
  assert.ok(bug!.dueIn < 0, 'the overdue heard card sets the word due');
  const table = rows.find((r) => r.key === 'table|noun');
  assert.equal(table!.label, 'relearning');
  assert.equal(table!.lapses, 2);
});

test('weakest first puts the word you keep forgetting on top', () => {
  const rows = summarise({ cards, reviews, wordOf, now });
  assert.deepEqual(sortRows(rows, 'weakest').map((r) => r.key), ['table|noun', 'bug|noun']);
  assert.deepEqual(sortRows(rows, 'strongest').map((r) => r.key), ['bug|noun', 'table|noun']);
  assert.deepEqual(sortRows(rows, 'recent').map((r) => r.key), ['table|noun', 'bug|noun']);
  assert.deepEqual(tally(rows), { new: 0, learning: 1, review: 0, known: 1 });
});

test('a new card reads as new even before FSRS has a state', () => {
  assert.equal(stateLabel({ state: State.New, reps: 0, mature: false }), 'new');
});

test('the strength bar is log scale and capped at a year', () => {
  assert.equal(strengthBar(0), 0);
  assert.ok(strengthBar(7) > 0.3 && strengthBar(7) < 0.4);
  assert.equal(strengthBar(5000), 1);
});

test('due text speaks in the unit that fits', () => {
  assert.equal(dueText(-3), '3 d overdue');
  assert.equal(dueText(0.5), 'due today');
  assert.equal(dueText(12), 'due in 12 d');
  assert.equal(dueText(90), 'due in 3 mo');
  assert.equal(dueText(800), 'due in 2.2 y');
});
