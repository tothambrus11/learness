/** Every drill the screen can offer has a lesson to read first: a table a
 *  learner could be asked to fill with nothing explaining the rule is a
 *  test, not a bit.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DRILL_RULE_IDS } from '../src/lib/grammar/deal.js';
import { LESSONS } from '../src/lib/grammar/lessons/index.js';
import { isRuleId, ruleOf } from '../src/lib/grammar/rules.js';

test('every rule with a generator has a lesson, with a name, a use, a formation and a worked example', () => {
  for (const rule of DRILL_RULE_IDS) {
    const lesson = LESSONS[rule];
    assert.ok(lesson, `${rule} has a lesson`);
    assert.ok(lesson.name.trim().length > 3, `${rule}: name`);
    for (const field of ['use', 'formation', 'example'] as const) {
      assert.ok(lesson[field].trim().length > 10, `${rule}: ${field}`);
    }
  }
});

test('every lesson is about a rule the registry knows, with a face the sitting can draw', () => {
  for (const [rule, lesson] of Object.entries(LESSONS)) {
    assert.ok(isRuleId(rule), rule);
    const faces = ruleOf(rule)?.faces ?? [];
    assert.ok(faces.includes('gap') || faces.includes('transform') || faces.includes('spell'),
      `${rule}: ${faces.join(', ')}`);
    assert.ok(lesson);
  }
});
