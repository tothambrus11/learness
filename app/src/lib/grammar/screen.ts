/** What the Grammar screen shows, decided away from the screen.
 *
 *  The rows are `tenseRows` (gate.ts). What this adds is the worked example
 *  beside a lesson: the learner's own best-known verb whose table has the
 *  tense, so the formation paragraph is read against forms they can already
 *  produce rather than against *parler*. Which verb that is comes from the
 *  cards; whether its table has the tense comes from the word, which the
 *  screen loads for the candidates in turn until one does.
 */
import type { Attempt, BitState, Conjugation, IndexEntry, RuleCard, StoredCard } from '../model.js';
import type { WordKey } from '../keys.js';
import { isMature } from '../scheduler.js';
import { breadthByRule, PASS_BREADTH, passed } from './derive.js';
import { openRules, TENSE_RULE } from './gate.js';
import { VERB_LESSONS } from './lessons/verbs.js';
import type { Lesson } from './lessons/verbs.js';
import { isRuleId, RULES } from './rules.js';
import type { RuleId } from './rules.js';
import { TABLE_RULE_IDS } from './table.js';
import { TENSE_NOTES } from '../tenses.js';

/** The learner's verbs, best known first: every verb of the catalogue with a
 *  written card, ordered by the card's stability, the mature ones first.
 *  The screen tries them in this order for a table that has the tense. */
export function candidateVerbs(
  cards: readonly StoredCard[], index: readonly IndexEntry[],
): WordKey[] {
  const verbs = new Set(index.filter((w) => w.k.endsWith('|verb')).map((w) => w.k));
  const best = new Map<WordKey, StoredCard>();
  for (const c of cards) {
    if (c.channel !== 'written' || c.retired || !verbs.has(c.key)) continue;
    const seen = best.get(c.key);
    if (!seen || c.stability > seen.stability) best.set(c.key, c);
  }
  return [...best.values()]
    .sort((a, b) => Number(isMature(b)) - Number(isMature(a)) || b.stability - a.stability
      || a.key.localeCompare(b.key))
    .map((c) => c.key);
}

/** Whether a verb's table has the tense to show: a simple tense is one of
 *  its groups with a form in it, a compound tense one of its compounds. */
export function hasTense(conj: Conjugation | null | undefined, tense: string): boolean {
  if (!conj) return false;
  return conj.groups.some((g) => g.id === tense && g.rows.some((r) => !!r.f))
    || conj.compound.some((c) => c.id === tense);
}

/** What the home screen says about the verb forms, in one line. */
export function formsLine(open: number, suggested: string | null): string {
  if (open === 0) return 'Verb forms: pick a tense to start';
  const tenses = `${open} tense${open === 1 ? '' : 's'} open`;
  return suggested ? `Verb forms: ${tenses} · next: ${suggested}` : `Verb forms: ${tenses}, every one`;
}

/** One row of the Grammar screen's list of drills: a rule with a table
 *  generator, whether it is started, and what it has earned. */
export interface DrillRow {
  rule: RuleId;
  lesson: Lesson;
  open: boolean;
  /** Distinct verbs the rule has been answered right on (derive.ts). */
  breadth: number;
  passed: boolean;
  /** The bits this one builds on that are not started: advice, not a lock. */
  missing: string[];
}

/** The drills the screen lists, in the inventory's order, with what each
 *  has earned read off the learner's records. */
export function drillRows(
  bits: readonly Pick<BitState, 'id' | 'deleted'>[], cards: readonly RuleCard[],
  attempts: readonly Attempt[],
): DrillRow[] {
  const open = openRules(bits);
  const wide = breadthByRule(attempts);
  return TABLE_RULE_IDS.flatMap((rule) => {
    const lesson = VERB_LESSONS[rule];
    if (!lesson) return [];
    return [{
      rule, lesson, open: open.has(rule),
      breadth: wide.get(rule) ?? 0,
      passed: passed(rule, cards, attempts),
      missing: RULES[rule].needs.filter((n) => !open.has(n)).map(nameOf),
    }];
  });
}

/** What a bit is called on the screen: its lesson's name where it has one,
 *  its tense's where it is a tense's bit, else its id. */
export function nameOf(rule: string): string {
  const lesson = isRuleId(rule) ? VERB_LESSONS[rule] : undefined;
  if (lesson) return lesson.name;
  const tense = Object.entries(TENSE_RULE).find(([, r]) => r === rule)?.[0];
  return (tense && TENSE_NOTES[tense]?.name) || rule;
}

/** What a drill row says it has earned, in a phrase: nothing yet, so many
 *  verbs right, or passed. */
export function earnedLine(row: Pick<DrillRow, 'breadth' | 'passed'>): string {
  if (row.passed) return `passed · right on ${row.breadth} verbs, and still asked now and then`;
  if (row.breadth === 0) return 'not answered right on any verb yet';
  return `right on ${row.breadth} verb${row.breadth === 1 ? '' : 's'} so far · passed at ${PASS_BREADTH}`;
}
