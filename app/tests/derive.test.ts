/** What is read off the grammar's records and never stored: the committed
 *  rules, a rule's breadth, whether a bit is passed, and which rules are owed.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { State } from 'ts-fsrs';
import { breadth, breadthByRule, cardOf, committed, dueRules, PASS_BREADTH, passed, summariseGrammar }
  from '../src/lib/grammar/derive.js';
import { secOf, trustMs } from '../src/lib/units.js';
import { MATURE_STABILITY } from '../src/lib/keys.js';
import { attempt, bit, ruleCard } from './make.js';

const now = new Date('2026-09-20T09:00:00Z');
const day = 24 * 3600 * 1000;

/** An attempt on one instance where each rule was observed as given. */
const on = (instance: string, obs: Record<string, boolean>) => attempt({
  instance,
  parts: [{ expected: 'x', got: 'x', ok: true,
    obs: Object.entries(obs).map(([of, ok]) => ({ of, ok })) }],
});

test('the committed rules are the open bits, in the inventory’s order, known rules only', () => {
  const bits = [bit('V.pres-er'), bit('N.units'), bit('G.pas', { deleted: true }), bit('X.future')];
  assert.deepEqual(committed(bits), ['N.units', 'V.pres-er'],
    'a closed bit is not committed; a rule this version does not know waits for one that does');
  assert.deepEqual(committed([]), []);
});

test('breadth counts the distinct instances a rule was right on, each once', () => {
  const attempts = [
    on('number:21', { 'N.et-un': true, 'N.tens': true }),
    on('number:21', { 'N.et-un': true, 'N.tens': true }),       /* the same number again */
    on('number:81', { 'N.et-un': true, 'N.tens': false }),      /* tens wrong on this one */
    on('number:200', { 'N.cent': true }),
  ];
  assert.equal(breadth(attempts, 'N.et-un'), 2, '21 and 81, the repeat once');
  assert.equal(breadth(attempts, 'N.tens'), 1, '81 was wrong on it');
  assert.equal(breadth(attempts, 'N.cent'), 1);
  assert.equal(breadth(attempts, 'N.mille'), 0, 'never seen');
  assert.deepEqual([...breadthByRule(attempts)], [['N.et-un', 2], ['N.tens', 1], ['N.cent', 1]]);
});

test('an instance counts for a rule only when every part that observed the rule was right', () => {
  const twoCells = attempt({ instance: 'table:parler|verb:pres', parts: [
    { expected: 'parle', got: 'parle', ok: true, obs: [{ of: 'V.pres-er', ok: true }] },
    { expected: 'parlons', got: 'parlon', ok: false, obs: [{ of: 'V.pres-er', ok: false }] },
  ] });
  assert.equal(breadth([twoCells], 'V.pres-er'), 0, 'one cell wrong is the table not right');
  assert.equal(breadth([on('number:21', { 'item:être|verb:imp:3': true })], 'item:être|verb:imp:3'), 0,
    'an item is not a rule and has no breadth');
});

test('a bit is passed on a mature card and a handful of instances, and stays open when it is', () => {
  const mature = ruleCard('N.et-un', 'produce', { state: State.Review, stability: MATURE_STABILITY });
  const young = ruleCard('N.et-un', 'produce', { state: State.Review, stability: 3 });
  const wide = Array.from({ length: PASS_BREADTH }, (_, i) => on(`number:${21 + 10 * i}`, { 'N.et-un': true }));
  assert.equal(passed('N.et-un', [mature], wide), true);
  assert.equal(passed('N.et-un', [young], wide), false, 'breadth without maturity is not passed');
  assert.equal(passed('N.et-un', [mature], wide.slice(1)), false, 'maturity without breadth is not passed');
  assert.equal(passed('N.et-un', [], wide), false, 'no card, nothing stuck');
  assert.equal(passed('N.et-un', [{ ...mature, retired: true }], wide), false, 'a retired card is a rule that is gone');
});

test('the card that says whether a rule has stuck is the produce card where there is one', () => {
  const rec = ruleCard('V.pc-vs-imp', 'recognise');
  const prod = ruleCard('V.pc-vs-imp', 'produce');
  assert.equal(cardOf('V.pc-vs-imp', [rec, prod]), prod);
  assert.equal(cardOf('V.pc-vs-imp', [rec]), rec);
  assert.equal(cardOf('V.pc-vs-imp', [ruleCard('G.pas')]), null);
});

test('the rules owed are the never-asked first, then the due by when they fell due; the rest wait', () => {
  const cards = [
    ruleCard('N.units', 'produce', { due: new Date(now.getTime() - day) }),
    ruleCard('N.tens', 'produce', { due: new Date(now.getTime() - 3 * day) }),
    ruleCard('N.cent', 'produce', { due: new Date(now.getTime() + day) }),
    ruleCard('N.mille', 'produce', { due: new Date(now.getTime() - day), retired: true }),
  ];
  assert.deepEqual(dueRules(['N.units', 'N.tens', 'N.cent', 'N.mille', 'N.teens'], cards, now),
    ['N.teens', 'N.tens', 'N.units'],
    'teens never asked; tens fell due before units; cent is tomorrow; mille is gone');
  assert.deepEqual(dueRules([], cards, now), []);
});

test('a rule with two cards is owed when either is due', () => {
  const cards = [
    ruleCard('V.pc-vs-imp', 'recognise', { due: new Date(now.getTime() + day) }),
    ruleCard('V.pc-vs-imp', 'produce', { due: new Date(now.getTime() - day) }),
  ];
  assert.deepEqual(dueRules(['V.pc-vs-imp'], cards, now), ['V.pc-vs-imp']);
});

test('the day’s grammar is its exercises, its cells, and each rule with how its cells went', () => {
  const at = new Date('2026-09-20T15:00:00Z');
  const ts = (hoursAgo: number) => secOf(trustMs(at.getTime() - hoursAgo * 3600 * 1000));
  const cell = (ok: boolean, obs: [string, boolean][]) =>
    ({ expected: 'x', got: ok ? 'x' : 'y', ok, obs: obs.map(([of, o]) => ({ of, ok: o })) });
  const attempts = [
    attempt({ ts: ts(1), instance: 'table:parler|verb:pres', parts: [
      cell(true, [['V.pres-er', true]]), cell(false, [['V.pres-er', false], ['item:parler|verb:pres:4', false]]),
    ] }),
    attempt({ ts: ts(2), instance: 'number:21', parts: [cell(true, [['N.et-un', true], ['N.tens', true]])] }),
    attempt({ ts: ts(30), instance: 'number:31', parts: [cell(true, [['N.et-un', true]])] }),   /* yesterday */
  ];
  const today = summariseGrammar(attempts, { at, dayStartsAt: 3 });
  assert.equal(today.exercises, 2);
  assert.equal(today.cells, 3);
  assert.equal(today.right, 2);
  assert.deepEqual(today.byRule, [
    { rule: 'V.pres-er', observed: 2, right: 1 },
    { rule: 'N.et-un', observed: 1, right: 1 },
    { rule: 'N.tens', observed: 1, right: 1 },
  ], 'the verb’s own item is not a rule, and yesterday is not today');
  assert.deepEqual(summariseGrammar([], { at, dayStartsAt: 3 }), { exercises: 0, cells: 0, right: 0, byRule: [] });
});
