/** Which grammar exercises a sitting deals, and on which of the learner's
 *  verbs: for each rule owed, one instance, on a verb the rule has not been
 *  answered on yet where there is one, else the one answered longest ago.
 *  Deterministic: the same records deal the same exercise on every device
 *  and every open, and the order among fresh verbs is the seeded shuffle
 *  the tap cards use, seeded by how much has been answered — the same
 *  rule dealt again after a sitting lands on a different verb.
 *
 *  Pure. session.ts reads the records and hands them in.
 */
import { orderedBy } from '../cardface.js';
import { ruleCardId } from '../keys.js';
import type { Attempt, RuleCard, StudyWord } from '../model.js';
import type { RuleItem } from '../queue.js';
import { emptyRuleCard } from '../scheduler.js';
import type { Instance } from './instance.js';
import { negationsFor } from './negation.js';
import type { RuleId } from './rules.js';
import { TABLE_RULE_IDS, tableFor, tableRuleOf } from './table.js';

/** The rules with a generator: what the Grammar screen offers as a drill
 *  and the sitting can deal. A rule not here is in the inventory and
 *  nothing else yet. */
export const DRILL_RULE_IDS: readonly RuleId[] = [...TABLE_RULE_IDS, 'G.pas'];

/** Every exercise a verb offers, whatever the rule. */
export const instancesFor = (word: Pick<StudyWord, 'k' | 'en' | 'conj'>): Instance[] =>
  [...TABLE_RULE_IDS.map((r) => tableFor(word, tableRuleOf(r)!)).filter((t): t is Instance => t !== null),
    ...negationsFor(word)];

/** The exercises on the learner's verbs that drill one rule. */
export function candidatesFor(rule: RuleId, verbs: readonly Pick<StudyWord, 'k' | 'en' | 'conj'>[]): Instance[] {
  const table = tableRuleOf(rule);
  if (table) return verbs.map((v) => tableFor(v, table)).filter((t): t is Instance => t !== null);
  if (rule === 'G.pas') return verbs.flatMap((v) => negationsFor(v));
  return [];
}

export interface DealInput {
  /** The rules owed, most owed first (grammar/derive.ts `dueRules`). */
  due: readonly RuleId[];
  /** The learner's verbs the exercises may be on, best known first. */
  verbs: readonly Pick<StudyWord, 'k' | 'en' | 'conj'>[];
  cards: readonly RuleCard[];
  attempts: readonly Attempt[];
  /** At most this many exercises. */
  limit: number;
  now?: Date;
}

/** The instance to deal for a rule: among those never answered, the seeded
 *  first; else the one answered longest ago. Null where the learner has no
 *  verb the rule applies to. */
export function pickInstance(
  candidates: readonly Instance[], attempts: readonly Attempt[],
): Instance | null {
  if (!candidates.length) return null;
  const lastAt = new Map<string, number>();
  for (const a of attempts) lastAt.set(a.instance, Math.max(lastAt.get(a.instance) ?? 0, a.ts));
  const fresh = candidates.filter((c) => !lastAt.has(c.id));
  if (fresh.length) return fresh[orderedBy(fresh.length, attempts.length)[0]!]!;
  return [...candidates].sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0)
    || (a.id < b.id ? -1 : 1))[0]!;
}

/** Deal the sitting's exercises. A rule with no generator yet, or none of
 *  the learner's verbs to be asked on, deals nothing and is not owed
 *  anything this sitting. */
export function dealRules({ due, verbs, cards, attempts, limit, now = new Date() }: DealInput): RuleItem[] {
  const out: RuleItem[] = [];
  for (const rule of due) {
    if (out.length >= limit) break;
    const instance = pickInstance(candidatesFor(rule, verbs), attempts);
    if (!instance) continue;
    const id = ruleCardId(rule, 'produce');
    const card = cards.find((c) => c.id === id && !c.retired) ?? emptyRuleCard(rule, 'produce', now);
    out.push({ kind: 'rule', card, instance });
  }
  return out;
}
