/** The cards screen: one row per word, carrying each channel at its live rung. */
import { Rating } from 'ts-fsrs';
import { expect, test } from 'vitest';

import {
  dueText,
  sortRows,
  stateLabel,
  strengthBar,
  summarise,
  tally,
} from '../src/lib/cardsview';
import { emptyCard, State } from '../src/lib/scheduler';
import type { Card, Channel, Review, Rung, StudyWord, WordKey } from '../src/lib/types';

/** The moment every "due in" below is measured from. */
const now = new Date('2026-03-01T08:00:00Z');

/** A card on one rung, with the scheduling state a test wants written over it.
 *  Built from `emptyCard` so every FSRS field is present and consistent. */
const card = (key: WordKey, channel: Channel, rung: Rung, extra: Partial<Card> = {}): Card => ({
  ...emptyCard(key, channel, rung, now),
  ...extra,
});

/** The two words the fixtures are about, as `wordOf()` hands them back. */
const words: Record<WordKey, StudyWord> = {
  'bug|noun': { k: 'bug|noun', fr: 'le bug', en: ['bug'], lvl: 1 },
  'table|noun': { k: 'table|noun', fr: 'la table', en: ['table'], lvl: 1 },
};

/** The rung `bug` has climbed off: retired when it promoted to `say`, and
 *  carrying the one lapse it took on the way, which still counts for the word. */
const retiredRung: Card = card('bug|noun', 'written', 'recognise', {
  state: State.Review,
  stability: 40,
  reps: 6,
  lapses: 1,
  retired: true,
  due: new Date('2026-03-20'),
  last_review: new Date('2026-02-10'),
});

/** One word that has climbed and opened its ear, and one that is relearning. */
const cards: Card[] = [
  retiredRung,
  card('bug|noun', 'written', 'say', {
    state: State.Review,
    stability: 40,
    difficulty: 4,
    reps: 6,
    lapses: 0,
    due: new Date('2026-03-20'),
    last_review: new Date('2026-02-10'),
  }),
  card('bug|noun', 'heard', 'hear', {
    state: State.Learning,
    stability: 2,
    reps: 1,
    due: new Date('2026-02-28'),
  }),
  card('table|noun', 'written', 'recognise', {
    state: State.Relearning,
    stability: 3,
    difficulty: 8,
    reps: 5,
    lapses: 2,
    due: new Date('2026-03-02'),
    last_review: new Date('2026-02-28'),
  }),
];

/** The answer history, trimmed to what `summarise()` reads of it. */
const reviews: Pick<Review, 'id' | 'rating'>[] = [
  { id: 'bug|noun|written|say', rating: Rating.Good },
  { id: 'bug|noun|written|say', rating: Rating.Easy },
  { id: 'bug|noun|written|say', rating: Rating.Again },
  { id: 'table|noun|written|recognise', rating: Rating.Again },
];

test('a word is one row carrying each channel at its live rung', () => {
  const rows = summarise({ cards, reviews, wordOf: (k) => words[k], now });
  const bug = rows.find((r) => r.key === 'bug|noun')!;
  expect(bug.fr).toBe('le bug');
  expect(bug.open).toEqual(['written', 'heard']);
  expect(bug.channels.written?.rung, 'the retired rung is not the live one').toBe('say');
  expect(bug.strength).toBe(40);
  expect(bug.label).toBe('known');
  expect(bug.lapses, 'a lapse on a retired rung still happened').toBe(1);
  expect(Math.abs((bug.channels.written?.accuracy ?? 0) - 2 / 3) < 1e-9).toBeTruthy();
  expect(bug.channels.heard?.accuracy).toBe(null);
  expect(bug.dueIn < 0, 'the overdue heard card sets the word due').toBeTruthy();
  const table = rows.find((r) => r.key === 'table|noun')!;
  expect(table.label).toBe('relearning');
  expect(table.lapses).toBe(2);
});

test('weakest first puts the word you keep forgetting on top', () => {
  const rows = summarise({ cards, reviews, wordOf: (k) => words[k], now });
  expect(sortRows(rows, 'weakest').map((r) => r.key)).toEqual(['table|noun', 'bug|noun']);
  expect(sortRows(rows, 'strongest').map((r) => r.key)).toEqual(['bug|noun', 'table|noun']);
  expect(sortRows(rows, 'recent').map((r) => r.key)).toEqual(['table|noun', 'bug|noun']);
  expect(tally(rows)).toEqual({ new: 0, learning: 1, review: 0, known: 1 });
});

test('a new card reads as new even before FSRS has a state', () => {
  expect(stateLabel({ state: State.New, reps: 0, mature: false })).toBe('new');
});

test('the strength bar is log scale and capped at a year', () => {
  expect(strengthBar(0)).toBe(0);
  expect(strengthBar(7) > 0.3 && strengthBar(7) < 0.4).toBeTruthy();
  expect(strengthBar(5000)).toBe(1);
});

test('due text speaks in the unit that fits', () => {
  expect(dueText(-3)).toBe('3 d overdue');
  expect(dueText(0.5)).toBe('due today');
  expect(dueText(12)).toBe('due in 12 d');
  expect(dueText(90)).toBe('due in 3 mo');
  expect(dueText(800)).toBe('due in 2.2 y');
});
