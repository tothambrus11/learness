/** A grammar exercise's cells judged, and what each says about the rules
 *  it observes: a form is a stem and an ending, and which is missing is
 *  which rule was misapplied.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { allRight, answerCells, cellRight } from '../src/lib/grammar/instance.js';
import type { Cell } from '../src/lib/grammar/instance.js';

const cell = (prompt: string, stem: string, ending: string, obs: Cell['obs'], also?: string[]): Cell =>
  ({ prompt, expected: stem + ending, stem, ending, obs, ...(also ? { also } : {}) });

const nous = cell('nous', 'parl', 'ons', [{ of: 'V.pres-er', on: 'ending' }]);
const il = cell('il', 'parl', 'e', [{ of: 'V.pres-er', on: 'ending' }, { of: 'item:aller|verb:pres:3', on: 'stem' }]);

test('a cell is right on the letter, accents and all, case forgiven', () => {
  assert.equal(cellRight({ expected: 'parlé' }, 'parlé'), true);
  assert.equal(cellRight({ expected: 'parlé' }, 'Parlé'), true);
  assert.equal(cellRight({ expected: 'parlé' }, 'parle'), false, 'the accent is the form');
  assert.equal(cellRight({ expected: 'paie', also: ['paye'] }, 'paye'), true, 'a variant is right');
  assert.equal(cellRight({ expected: 'parle' }, ''), false);
});

test('a right cell is right about everything it observes; an empty one wrong about everything', () => {
  const [ok] = answerCells({ cells: [il] }, ['parle']);
  assert.deepEqual(ok, { expected: 'parle', got: 'parle', ok: true,
    obs: [{ of: 'V.pres-er', ok: true }, { of: 'item:aller|verb:pres:3', ok: true }] });
  const [empty] = answerCells({ cells: [il] }, []);
  assert.deepEqual(empty?.obs, [{ of: 'V.pres-er', ok: false }, { of: 'item:aller|verb:pres:3', ok: false }]);
  assert.equal(empty?.got, '');
});

test('a wrong cell blames the ending only where the ending is missing, and the stem only where the stem is', () => {
  const [wrongEnding] = answerCells({ cells: [nous] }, ['parlent']);
  assert.deepEqual(wrongEnding?.obs, [{ of: 'V.pres-er', ok: false }], '-ent for -ons is the ending rule');
  const [wrongStem] = answerCells({ cells: [il] }, ['vaie']);
  assert.deepEqual(wrongStem?.obs, [{ of: 'V.pres-er', ok: true }, { of: 'item:aller|verb:pres:3', ok: false }],
    'the -e is there, so the ending rule is not what went wrong; the stem is');
  const [both] = answerCells({ cells: [il] }, ['vont']);
  assert.deepEqual(both?.obs, [{ of: 'V.pres-er', ok: false }, { of: 'item:aller|verb:pres:3', ok: false }]);
});

test('a whole-form observation is right only when the cell is', () => {
  const whole = cell('281', '', '', [{ of: 'N.et-un', on: 'form' }]);
  whole.expected = 'deux cent quatre-vingt-un';
  const [near] = answerCells({ cells: [whole] }, ['deux cent quatre-vingt-et-un']);
  assert.deepEqual(near?.obs, [{ of: 'N.et-un', ok: false }]);
  assert.equal(allRight(answerCells({ cells: [nous, il] }, ['parlons', 'parle'])), true);
  assert.equal(allRight(answerCells({ cells: [nous, il] }, ['parlons', 'parlent'])), false);
});
