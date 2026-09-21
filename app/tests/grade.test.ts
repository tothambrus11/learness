/** How an exercise's parts become grades: one grade per rule from its own
 *  observations, one per verb from its own cells, on the card the face's
 *  mode names (GRAMMAR.md, "Grading: a rule is not a word").
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Rating } from 'ts-fsrs';
import { FACE_MODE, itemRef, parseItemRef, routeGrades, ruleGrade, tally }
  from '../src/lib/grammar/grade.js';
import { CLIMB_STREAK } from '../src/lib/ladder.js';
import type { AttemptPart } from '../src/lib/model.js';
import { k } from './make.js';

const part = (ok: boolean, obs: [string, boolean][]): AttemptPart => ({
  expected: 'x', got: ok ? 'x' : 'y', ok, obs: obs.map(([of, o]) => ({ of, ok: o })),
});

test('over one card’s observations: all right is Good, one wrong is Hard, more is Again', () => {
  const table: [boolean[], Rating | null][] = [
    [[], null],
    [[true], Rating.Good],
    [[true, true, true], Rating.Good],
    [[false], Rating.Hard],
    [[true, false, true], Rating.Hard],
    [[false, false], Rating.Again],
    [[true, false, false, true], Rating.Again],
  ];
  for (const [oks, want] of table) assert.equal(tally(oks), want, JSON.stringify(oks));
});

test('a rule right on every part is Easy on a streak, as the ladder climbs today; a slip resets nothing here', () => {
  assert.equal(ruleGrade([true, true], 0), Rating.Good);
  assert.equal(ruleGrade([true, true], CLIMB_STREAK - 1), Rating.Good);
  assert.equal(ruleGrade([true, true], CLIMB_STREAK), Rating.Easy);
  assert.equal(ruleGrade([true, false], CLIMB_STREAK), Rating.Hard, 'a slip is a slip whatever the streak');
  assert.equal(ruleGrade([], CLIMB_STREAK), null);
});

test('the four numbers 21, 200, 281, 1000 grade each rule on its own observations', () => {
  /* GRAMMAR.md's own example: et-un on two, cent on two, mille on one, the
     hyphen rule on three — here with 281 wrong on its et-un. */
  const parts = [
    part(true, [['N.tens-units', true], ['N.et-un', true]]),
    part(true, [['N.cent', true]]),
    part(false, [['N.cent', true], ['N.tens-units', true], ['N.et-un', false]]),
    part(true, [['N.mille', true]]),
  ];
  const { rules, items } = routeGrades(parts, 'produce');
  assert.deepEqual(items, [], 'no verb in it');
  assert.deepEqual(rules, [
    { id: 'N.tens-units|produce', rule: 'N.tens-units', rating: Rating.Good },
    { id: 'N.et-un|produce', rule: 'N.et-un', rating: Rating.Hard },
    { id: 'N.cent|produce', rule: 'N.cent', rating: Rating.Good },
    { id: 'N.mille|produce', rule: 'N.mille', rating: Rating.Good },
  ]);
});

test('an irregular never punishes the rule it is an exception to, and the rule never hides the irregular', () => {
  /* être's imparfait: the stem cell wrong, the ending right on every cell. */
  const parts = [
    part(true, [['V.imparfait', true]]),
    part(true, [['V.imparfait', true]]),
    part(false, [['V.imparfait', true], [itemRef(k('être|verb'), 'imp', '3'), false]]),
    part(true, [['V.imparfait', true], [itemRef(k('être|verb'), 'imp', '4'), true]]),
  ];
  const { rules, items } = routeGrades(parts, 'produce');
  assert.deepEqual(rules, [{ id: 'V.imparfait|produce', rule: 'V.imparfait', rating: Rating.Good }],
    'the ending rule is Good: every part that observed it was right');
  assert.deepEqual(items, [{
    key: 'être|verb', rating: Rating.Hard,
    missed: [{ key: 'être|verb', tense: 'imp', person: '3' }],
  }], 'the verb’s own card takes the slip, and remembers which cell');
});

test('a rule’s streak is read off its card by id; the face decides which card', () => {
  const parts = [part(true, [['G.pas', true]])];
  const streak = (id: string): number => (id === 'G.pas|recognise' ? CLIMB_STREAK : 0);
  assert.equal(routeGrades(parts, 'recognise', streak).rules[0]?.rating, Rating.Easy);
  assert.equal(routeGrades(parts, 'produce', streak).rules[0]?.rating, Rating.Good,
    'the produce card has no streak, so a plain Good');
});

test('a label this version does not know is ignored, not graded', () => {
  const parts = [part(false, [['X.from-the-future', false], ['G.pas', true]])];
  const { rules } = routeGrades(parts, 'produce');
  assert.deepEqual(rules.map((r) => r.rule), ['G.pas']);
});

test('every face has a mode, and what the learner writes or says is production', () => {
  assert.equal(FACE_MODE.gap, 'produce');
  assert.equal(FACE_MODE.spell, 'produce');
  assert.equal(FACE_MODE.which, 'recognise');
  assert.equal(FACE_MODE.read, 'recognise');
});

test('an item ref round-trips, and anything else is not one', () => {
  const ref = itemRef(k('être|verb'), 'imp', '3');
  assert.equal(ref, 'item:être|verb:imp:3');
  assert.deepEqual(parseItemRef(ref), { key: 'être|verb', tense: 'imp', person: '3' });
  assert.equal(parseItemRef('V.imparfait'), null);
  assert.equal(parseItemRef('item:être|verb'), null, 'a ref with no tense and person is not one');
  assert.equal(parseItemRef('item::imp:3'), null);
});
