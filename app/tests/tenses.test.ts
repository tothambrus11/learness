/** The tense notes, as a table: every tense the table heads has its use and
 *  its formation said, and every tense a card can ask is behind a rule.
 *
 *  The notes were constants with no test, and rightly, until one of them
 *  became the lesson a learner reads before opening a tense (GRAMMAR.md):
 *  a tense with no formation would be a bit with nothing to read.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CORE_TENSES } from '../src/lib/conjspeech.js';
import { READ_ONLY_TENSES, TENSE_RULE } from '../src/lib/grammar/gate.js';
import { TENSE_NOTES, TIME_MEANING } from '../src/lib/tenses.js';

test('every tense says what it is for and how it is built, in a paragraph', () => {
  for (const [id, note] of Object.entries(TENSE_NOTES)) {
    assert.ok(note.name, `${id} is named`);
    assert.ok(note.use.length > 80, `${id} says what it is for`);
    assert.ok(note.formation.length > 80, `${id} says how it is built`);
    assert.match(note.formation, /[.!]$/, `${id}'s formation ends as a paragraph does`);
  }
});

test('every tense a card can ask is behind a rule, and the read-only ones are marked', () => {
  for (const id of Object.keys(TENSE_NOTES)) {
    if (READ_ONLY_TENSES.includes(id)) {
      assert.match(TENSE_NOTES[id]!.formation, /Recognised, never produced/,
        `${id} is read-only, and its formation says so first`);
    } else {
      assert.ok(TENSE_RULE[id], `${id} is gated by a rule`);
    }
  }
  for (const id of CORE_TENSES) assert.ok(TENSE_NOTES[id], `${id}, said aloud, has a note`);
  for (const id of Object.keys(TIME_MEANING)) assert.ok(TENSE_NOTES[id], `${id}, a time to choose, has a note`);
});
