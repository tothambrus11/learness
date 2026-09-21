/** The registry is the document: every rule GRAMMAR.md's tables list is in
 *  RULES with the same needs, faces and placing, and nothing is in RULES
 *  that the document does not list. The document is where a rule is
 *  described; the registry is what the app reads; a change to one and not
 *  the other fails here.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RULES, RULE_IDS, isRuleId, ruleOf } from '../src/lib/grammar/rules.js';
import { TENSE_NEEDS, TENSE_RULE } from '../src/lib/grammar/gate.js';

interface Row { id: string; needs: string[]; after: string[]; faces: string[]; placed: string }

/** The rows of the document's tables, read the way scripts/grammar-rules.py reads them. */
function documented(): Row[] {
  const doc = readFileSync(fileURLToPath(new URL('../../GRAMMAR.md', import.meta.url)), 'utf8');
  return [...doc.matchAll(/^\| ([A-Z]\.[\w-]+) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/gm)].map((m) => ({
    id: m[1]!,
    after: [...m[2]!.matchAll(/· after ([A-Z]\.[\w-]+)/g)].map((a) => a[1]!),
    needs: m[3]!.split(',').map((n) => n.trim()).filter((n) => n && n !== '—'),
    faces: m[4]!.split(',').map((f) => f.trim()).filter(Boolean),
    placed: m[5]!.trim(),
  }));
}

test('the registry lists exactly the rules the document does, wired the same way', () => {
  const rows = documented();
  assert.ok(rows.length > 150, 'the document was found and has its tables');
  assert.deepEqual(RULE_IDS, rows.map((r) => r.id), 'the same rules in the same order');
  for (const row of rows) {
    const rule = RULES[row.id as keyof typeof RULES];
    assert.deepEqual([...rule.needs], row.needs, `${row.id} needs`);
    assert.deepEqual([...rule.after], row.after, `${row.id} after`);
    assert.deepEqual([...rule.faces], row.faces, `${row.id} faces`);
    assert.equal(rule.placed, row.placed, `${row.id} placed`);
    assert.ok(rule.what.length > 10, `${row.id} says what it is`);
  }
});

test('every need names a rule, and the needs make no cycle', () => {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    assert.notEqual(state.get(id), 1, `a cycle: ${[...path, id].join(' → ')}`);
    if (state.get(id) === 2) return;
    state.set(id, 1);
    const rule = ruleOf(id);
    assert.ok(rule, `${id} is a rule`);
    for (const need of [...rule.needs, ...rule.after]) {
      assert.ok(isRuleId(need), `${id} builds on ${need}, which is a rule`);
      visit(need, [...path, id]);
    }
    state.set(id, 2);
  };
  for (const id of RULE_IDS) visit(id, []);
});

test('the tense gate names rules of the registry, and its advice is the registry\'s where both speak', () => {
  for (const [tense, rule] of Object.entries(TENSE_RULE)) {
    assert.ok(isRuleId(rule), `${tense} is gated by ${rule}, a rule`);
    /* A tense the registry says one tense builds on is in the gate's advice
       too; the gate may say more (the meaning pairs), never contradict. */
    const tenseOf = new Map(Object.entries(TENSE_RULE).map(([t, r]) => [r, t]));
    for (const need of RULES[rule].needs) {
      const t = tenseOf.get(need);
      if (t) assert.ok(TENSE_NEEDS[tense]?.includes(t), `${tense} builds on ${t} in the document`);
    }
  }
});
