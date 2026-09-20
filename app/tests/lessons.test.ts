/** Every drill the screen can offer has a lesson to read first: a table a
 *  learner could be asked to fill with nothing explaining the rule is a
 *  test, not a bit.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { VERB_LESSONS } from '../src/lib/grammar/lessons/verbs.js';
import { isRuleId, ruleOf } from '../src/lib/grammar/rules.js';
import { TABLE_RULE_IDS } from '../src/lib/grammar/table.js';

test('every rule with a table has a lesson, with a name, a use, a formation and a worked verb', () => {
  for (const rule of TABLE_RULE_IDS) {
    const lesson = VERB_LESSONS[rule];
    assert.ok(lesson, `${rule} has a lesson`);
    for (const field of ['name', 'use', 'formation', 'example'] as const) {
      assert.ok(lesson[field].trim().length > 10, `${rule}: ${field}`);
    }
  }
});

test('every lesson is about a rule the registry knows, and one with a gap face', () => {
  for (const [rule, lesson] of Object.entries(VERB_LESSONS)) {
    assert.ok(isRuleId(rule), rule);
    assert.ok(ruleOf(rule)?.faces.includes('gap'), `${rule} is drilled by filling gaps`);
    assert.ok(lesson);
  }
});
