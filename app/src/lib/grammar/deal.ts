/** Which grammar exercises a sitting deals, and on which of the learner's
 *  words: for each rule owed, one instance, on a word the rule has not been
 *  answered on yet where there is one, else the one answered longest ago.
 *  Deterministic: the same records deal the same exercise on every device
 *  and every open, and the order among fresh verbs is the seeded shuffle
 *  the tap cards use, seeded by how much has been answered — the same
 *  rule dealt again after a sitting lands on a different word.
 *
 *  Pure. session.ts reads the records and hands them in.
 */
import { orderedBy } from '../shuffle.js';
import { ruleCardId } from '../keys.js';
import type { Attempt, RuleCard, StudyWord } from '../model.js';
import type { RuleItem } from '../queue.js';
import { emptyRuleCard } from '../scheduler.js';
import { DETERMINER_RULE_IDS, determinerFor, determinersFor } from './determiners.js';
import type { Instance } from './instance.js';
import { NEGATION_RULE_IDS, negationsFor } from './negation.js';
import { AGE_POOL, ageFor, agesFor, DATE_POOL, dateFor, datesFor, NUMBER_POOLS, numberFor, numberRules,
  numbersFor, ordinalFor, ordinalsFor, PRICE_POOL, priceFor, pricesFor, timeFor, timesFor } from './numbers.js';
import { questionsFor } from './questions.js';
import type { Dialect } from './numbers.js';
import type { RuleId } from './rules.js';
import { allFormsFor, compoundFor, compoundRuleOf, formsFor, TABLE_RULE_IDS, tableFor, tableRuleOf, tablesFor }
  from './table.js';

/** The number bits beyond writing a number: each with a pool of its own. */
const NUMBER_EXTRA: readonly RuleId[] = ['N.ordinal', 'N.time', 'N.date', 'N.age-duration', 'N.prices'];

/** The rules with a generator: what the Grammar screen offers as a drill
 *  and the sitting can deal. A rule not here is in the inventory and
 *  nothing else yet. */
export const DRILL_RULE_IDS: readonly RuleId[] =
  [...TABLE_RULE_IDS, ...NEGATION_RULE_IDS, 'Q.yes-no', ...DETERMINER_RULE_IDS,
    ...Object.keys(NUMBER_POOLS) as RuleId[], ...NUMBER_EXTRA];

/** The rules made from a number rather than from the learner's words. */
const NUMBER_MADE = new Set<RuleId>([...Object.keys(NUMBER_POOLS) as RuleId[], ...NUMBER_EXTRA]);

/** What a rule's exercises are made from: the learner's verbs (a table, a
 *  sentence), their nouns (a determiner), or nothing (a number). What the
 *  sitting reads to know which words to look up. */
export const madeFrom = (rule: RuleId): 'verbs' | 'nouns' | 'nothing' =>
  (NUMBER_MADE.has(rule) ? 'nothing' : DETERMINER_RULE_IDS.includes(rule) ? 'nouns' : 'verbs');

/** The rules with a generator for this learner: the French compounds are
 *  drilled only by a learner who writes them. */
export const drillRules = (dialect: Dialect): RuleId[] =>
  DRILL_RULE_IDS.filter((r) => !(r in NUMBER_POOLS) || numberRules(dialect).includes(r));

/** The exercise behind an instance id, made again: a word's, from the
 *  word; a number's, from the number. Null where nothing makes it. */
export function instanceForId(
  id: string, word: Pick<StudyWord, 'k' | 'en' | 'fr' | 'gender' | 'number' | 'conj'> | null,
  dialect: Dialect = 'ch',
): Instance | null {
  const num = /^number:(\d+)(?::fr)?$/.exec(id);
  if (num) {
    const n = Number(num[1]);
    const rule = numberRules(dialect).find((r) => NUMBER_POOLS[r]?.includes(n));
    return rule ? numberFor(n, rule, dialect) : null;
  }
  const ord = /^ordinal:(\d+)$/.exec(id);
  if (ord) return ordinalFor(Number(ord[1]), dialect);
  const time = /^time:(\d+):(\d+)$/.exec(id);
  if (time) return timeFor(Number(time[1]), Number(time[2]), dialect);
  if (id.startsWith('date:')) {
    const spec = DATE_POOL.find((d) => dateFor(d, dialect).id === id);
    return spec ? dateFor(spec, dialect) : null;
  }
  if (id.startsWith('age:')) {
    const spec = AGE_POOL.find((a) => ageFor(a, dialect).id === id);
    return spec ? ageFor(spec, dialect) : null;
  }
  if (id.startsWith('price:')) {
    const spec = PRICE_POOL.find((p) => priceFor(p, dialect).id === id);
    return spec ? priceFor(spec, dialect) : null;
  }
  return word ? instancesFor(word).find((i) => i.id === id) ?? null : null;
}

/** Every exercise a word offers, whatever the rule: a verb's tables and
 *  sentences, a noun's determiners. */
export const instancesFor = (word: Pick<StudyWord, 'k' | 'en' | 'fr' | 'gender' | 'number' | 'conj'>): Instance[] =>
  [...tablesFor(word), ...allFormsFor(word), ...NEGATION_RULE_IDS.flatMap((r) => negationsFor(word, r)),
    ...questionsFor(word), ...determinersFor(word)];

/** The exercises on the learner's words that drill one rule. A table rule
 *  that is passed is kept with single forms rather than whole tables: the
 *  table taught the pattern, one cell at a time is how it stays. */
export function candidatesFor(
  rule: RuleId, verbs: readonly Pick<StudyWord, 'k' | 'en' | 'conj'>[], dialect: Dialect = 'ch',
  nouns: readonly Pick<StudyWord, 'k' | 'en' | 'fr' | 'gender' | 'number'>[] = [],
  isPassed = false,
): Instance[] {
  if (DETERMINER_RULE_IDS.includes(rule)) {
    return nouns.map((n) => determinerFor(n, rule)).filter((i): i is Instance => i !== null);
  }
  const table = tableRuleOf(rule) ?? compoundRuleOf(rule);
  if (table) {
    if (isPassed) return verbs.flatMap((v) => formsFor(v, table));
    return verbs.map((v) => ('endings' in table ? tableFor(v, table) : compoundFor(v, table)))
      .filter((t): t is Instance => t !== null);
  }
  if (NEGATION_RULE_IDS.includes(rule)) return verbs.flatMap((v) => negationsFor(v, rule));
  if (rule === 'Q.yes-no') return verbs.flatMap((v) => questionsFor(v));
  if (rule in NUMBER_POOLS) return numberRules(dialect).includes(rule) ? numbersFor(rule, dialect) : [];
  if (rule === 'N.ordinal') return ordinalsFor(dialect);
  if (rule === 'N.time') return timesFor(dialect);
  if (rule === 'N.date') return datesFor(dialect);
  if (rule === 'N.age-duration') return agesFor(dialect);
  if (rule === 'N.prices') return pricesFor(dialect);
  return [];
}

export interface DealInput {
  /** The rules owed, most owed first (grammar/derive.ts `dueRules`). */
  due: readonly RuleId[];
  /** The learner's verbs the exercises may be on, best known first. */
  verbs: readonly Pick<StudyWord, 'k' | 'en' | 'conj'>[];
  /** Their nouns, likewise, for the determiner drills. */
  nouns?: readonly Pick<StudyWord, 'k' | 'en' | 'fr' | 'gender' | 'number'>[];
  cards: readonly RuleCard[];
  attempts: readonly Attempt[];
  /** At most this many exercises. */
  limit: number;
  /** Which numerals the number drills ask for (Settings.numerals). */
  dialect?: Dialect;
  /** The rules that are passed (grammar/derive.ts): kept with single forms
   *  rather than whole tables. */
  passed?: ReadonlySet<RuleId>;
  now?: Date;
}

/** The instance to deal for a rule: among those never answered, the seeded
 *  first; else the one answered longest ago. Null where the learner has no
 *  word the rule applies to. */
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
 *  the learner's words to be asked on, deals nothing and is not owed
 *  anything this sitting. */
export function dealRules({
  due, verbs, nouns = [], cards, attempts, limit, dialect = 'ch', passed = new Set(), now = new Date(),
}: DealInput): RuleItem[] {
  const out: RuleItem[] = [];
  for (const rule of due) {
    if (out.length >= limit) break;
    const instance = pickInstance(candidatesFor(rule, verbs, dialect, nouns, passed.has(rule)), attempts);
    if (!instance) continue;
    const id = ruleCardId(rule, 'produce');
    const card = cards.find((c) => c.id === id && !c.retired) ?? emptyRuleCard(rule, 'produce', now);
    out.push({ kind: 'rule', card, instance });
  }
  return out;
}
