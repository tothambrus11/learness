/** What is derived from the grammar's records and never stored: which
 *  rules the learner has committed to, how broadly each has been answered
 *  right, whether a bit is passed, and which rules are due
 *  (GRAMMAR.md, "Not stored, because derived").
 *
 *  Each of these is a rule about learning, and a rule that is derived
 *  changes when the code changes, with no migration. Every function here is
 *  pure over the records it is handed; the screens and the dealer read
 *  them, and a table in tests/derive.test.ts says what each is worth.
 */
import type { Attempt, BitState, RuleCard } from '../model.js';
import { dayStart } from '../progress.js';
import { isDue, isMature } from '../scheduler.js';
import { DAY_MS, msOf, whenMs } from '../units.js';
import { openRules } from './gate.js';
import { isRuleId, RULE_IDS } from './rules.js';
import type { RuleId } from './rules.js';

/** The rules the learner has committed to: the open bits, in the
 *  inventory's order, leaving out a bit whose rule this version does not
 *  know — it stays in the records for a version that does. */
export function committed(bits: readonly Pick<BitState, 'id' | 'deleted'>[]): RuleId[] {
  const open = openRules(bits);
  return RULE_IDS.filter((id) => open.has(id));
}

/** Distinct instances each rule has been answered right on: an attempt
 *  counts for a rule when every part that observed the rule was right, and
 *  it counts its instance once however many times it was answered. A table
 *  on one verb is one instance of the ending rule; four sentences on four
 *  verbs are four. */
export function breadthByRule(attempts: readonly Attempt[]): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const a of attempts) {
    const outcome = new Map<string, boolean>();
    for (const part of a.parts) {
      for (const ob of part.obs) outcome.set(ob.of, (outcome.get(ob.of) ?? true) && ob.ok);
    }
    for (const [label, ok] of outcome) {
      if (!ok || !isRuleId(label)) continue;
      const s = seen.get(label) ?? new Set<string>();
      s.add(a.instance);
      seen.set(label, s);
    }
  }
  return new Map([...seen].map(([rule, s]) => [rule, s.size]));
}

/** One rule's breadth (see `breadthByRule`). */
export const breadth = (attempts: readonly Attempt[], rule: string): number =>
  breadthByRule(attempts).get(rule) ?? 0;

/** Distinct instances a rule must have been right on, with a mature card,
 *  to count as passed: a handful, so a rule that generalises is seen to. */
export const PASS_BREADTH = 4;

/** The card of a rule that says whether it has stuck: the produce card
 *  where the rule has one, since producing is the harder memory, else
 *  whichever it has. A retired card is a rule that is gone. */
export function cardOf(rule: string, cards: readonly RuleCard[]): RuleCard | null {
  const live = cards.filter((c) => c.rule === rule && !c.retired);
  return live.find((c) => c.mode === 'produce') ?? live[0] ?? null;
}

/** Whether a bit is passed: its card is mature and its breadth is a
 *  handful. A passed bit does not close — its card stays in the scheduler,
 *  so a rule unused for a month comes back on new instances; what passing
 *  changes is what the screen says, and which bits it suggests next. */
export function passed(
  rule: string, cards: readonly RuleCard[], attempts: readonly Attempt[],
): boolean {
  return isMature(cardOf(rule, cards)) && breadth(attempts, rule) >= PASS_BREADTH;
}

/** The committed rules the sitting owes an exercise on, most owed first: a
 *  rule never asked comes before one that is due, and among the due the one
 *  that fell due first. A rule whose every card is retired is not owed. */
export function dueRules(
  rules: readonly RuleId[], cards: readonly RuleCard[], now: Date = new Date(),
): RuleId[] {
  const dueAt = (rule: RuleId): number | null => {
    const own = cards.filter((c) => c.rule === rule);
    if (own.length === 0) return 0;                       /* never asked */
    const live = own.filter((c) => !c.retired);
    const due = live.filter((c) => isDue(c, now)).map((c) => whenMs(c.due));
    return due.length ? Math.min(...due) : null;          /* retired only: gone */
  };
  return rules
    .map((rule) => ({ rule, at: dueAt(rule) }))
    .filter((r): r is { rule: RuleId; at: number } => r.at !== null)
    .sort((a, b) => a.at - b.at || RULE_IDS.indexOf(a.rule) - RULE_IDS.indexOf(b.rule))
    .map((r) => r.rule);
}

/** What the day's grammar came to: exercises answered, cells right, and
 *  each rule observed with how its cells went — what the Today screen
 *  shows beside the words. Read off the attempts, as the words' day is
 *  read off the reviews. */
export interface GrammarDay {
  exercises: number;
  cells: number;
  right: number;
  /** Rules observed today, most observed first. */
  byRule: { rule: string; observed: number; right: number }[];
}

export function summariseGrammar(attempts: readonly Attempt[], { at = new Date(), dayStartsAt }: {
  at?: Date;
  /** The hour the day turns: `Settings.dayStartsAt`. */
  dayStartsAt: number;
}): GrammarDay {
  const from = dayStart(at, dayStartsAt);
  const to = from + DAY_MS;
  const today = attempts.filter((a) => msOf(a.ts) >= from && msOf(a.ts) < to);
  const seen = new Map<string, { observed: number; right: number }>();
  let cells = 0;
  let right = 0;
  for (const a of today) {
    for (const part of a.parts) {
      cells += 1;
      if (part.ok) right += 1;
      for (const ob of part.obs) {
        if (!isRuleId(ob.of)) continue;
        const r = seen.get(ob.of) ?? { observed: 0, right: 0 };
        r.observed += 1;
        if (ob.ok) r.right += 1;
        seen.set(ob.of, r);
      }
    }
  }
  const byRule = [...seen].map(([rule, r]) => ({ rule, observed: r.observed, right: r.right }))
    .sort((a, b) => b.observed - a.observed || a.rule.localeCompare(b.rule));
  return { exercises: today.length, cells, right, byRule };
}
