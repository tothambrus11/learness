/** The tense gate, as a table: every tense of the verb table is either
 *  gated by a rule that GRAMMAR.md lists or is read-only, the advice is a
 *  graph with no cycle, and what is open is what the learner opened.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  READ_ONLY_TENSES, TENSE_NEEDS, TENSE_ORDER, TENSE_RULE, openedTenses, suggestedNext, tenseRows,
} from '../src/lib/grammar/gate.js';
import { CORE_TENSES } from '../src/lib/conjspeech.js';
import { TENSE_NOTES } from '../src/lib/tenses.js';
import { bit } from './make.js';

/** The rule ids GRAMMAR.md's tables list, read off the document itself: the
 *  gate's ids are records for ever, so they had better be the document's. */
function documentedRules(): Set<string> {
  const doc = readFileSync(fileURLToPath(new URL('../../GRAMMAR.md', import.meta.url)), 'utf8');
  return new Set([...doc.matchAll(/^\| ([A-Z]\.[\w-]+) \|/gm)].map((m) => m[1]!));
}

test('every tense of the table is gated by a documented rule, or is read-only', () => {
  const rules = documentedRules();
  assert.ok(rules.size > 100, 'the document was found and has its tables');
  for (const tense of Object.keys(TENSE_NOTES)) {
    if (READ_ONLY_TENSES.includes(tense)) {
      assert.equal(TENSE_RULE[tense], undefined, `${tense} is read-only and has no rule`);
      continue;
    }
    const rule = TENSE_RULE[tense];
    assert.ok(rule, `${tense} is gated`);
    assert.ok(rules.has(rule), `${rule} is a rule GRAMMAR.md lists`);
    assert.ok(TENSE_ORDER.includes(tense), `${tense} has a place in the order`);
    assert.ok(tense in TENSE_NEEDS, `${tense} says what it builds on`);
  }
  assert.deepEqual([...TENSE_ORDER].sort(), Object.keys(TENSE_RULE).sort(),
    'the order lists each gated tense once');
  for (const tense of CORE_TENSES) assert.ok(TENSE_RULE[tense], `${tense}, said aloud, is gated`);
});

test('the advice is a graph with no cycle, over tenses that exist, and the présent needs nothing', () => {
  assert.deepEqual(TENSE_NEEDS.pres, []);
  const state = new Map<string, 1 | 2>();
  const visit = (t: string, path: string[]): void => {
    assert.notEqual(state.get(t), 1, `a cycle: ${[...path, t].join(' → ')}`);
    if (state.get(t) === 2) return;
    state.set(t, 1);
    for (const need of TENSE_NEEDS[t] ?? []) {
      assert.ok(need in TENSE_RULE, `${t} builds on ${need}, which is a tense`);
      visit(need, [...path, t]);
    }
    state.set(t, 2);
  };
  for (const t of TENSE_ORDER) visit(t, []);
});

test('what is open is what the learner opened, and a closed bit is closed', () => {
  assert.deepEqual(openedTenses([]), [], 'nothing until the learner opens something');
  assert.equal(suggestedNext([]), 'pres', 'and the présent is where to start');

  const bits = [bit('V.pres-er'), bit('V.pc'), bit('V.imparfait', { deleted: true })];
  assert.deepEqual(openedTenses(bits), ['pres', 'pc'], 'in table order; the tombstone is closed');
  assert.equal(suggestedNext(bits), 'imp', 'the first in order that is not open');

  const rows = tenseRows(bits);
  assert.deepEqual(rows.map((r) => r.tense), [...TENSE_ORDER]);
  assert.equal(rows.find((r) => r.tense === 'pc')?.open, true);
  assert.equal(rows.find((r) => r.tense === 'imp')?.suggested, true);
  assert.deepEqual(rows.find((r) => r.tense === 'cond')?.missing.map((m) => m.tense), ['fut', 'imp'],
    'what it builds on that is not open yet — said, not enforced');
  assert.deepEqual(rows.find((r) => r.tense === 'pc')?.missing, [], 'nothing missing under an open one');
  assert.equal(rows.find((r) => r.tense === 'imp')?.name, 'Imparfait', 'named as the table heads it');

  const all = TENSE_ORDER.map((t) => bit(TENSE_RULE[t]!));
  assert.equal(suggestedNext(all), null, 'nothing to suggest once every tense is open');
});
