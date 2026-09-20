/** What the home screen's Study button says, over every state it can be in. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { studyLine } from '../src/lib/home.js';

test('the Study button says what is owed: cards, exercises, or the new words there is room for', () => {
  const table: [Parameters<typeof studyLine>[0], string][] = [
    [{ due: 3, allowance: 5, carryOn: false }, 'Study: 3 due cards'],
    [{ due: 1, allowance: 0, carryOn: true }, 'Carry on: 1 due card'],
    [{ due: 3, allowance: 5, carryOn: false, drills: 2 }, 'Study: 3 due cards · 2 grammar exercises'],
    [{ due: 0, allowance: 5, carryOn: false, drills: 1 }, 'Study: 1 grammar exercise'],
    [{ due: 0, allowance: 5, carryOn: false }, 'Start: 5 new words'],
    [{ due: 0, allowance: 5, carryOn: true }, 'Carry on: 5 new words'],
    [{ due: 0, allowance: 0, carryOn: false }, 'Study'],
    [{ due: 0, allowance: 0, carryOn: true }, 'Carry on'],
  ];
  for (const [input, want] of table) assert.equal(studyLine(input), want, JSON.stringify(input));
});
