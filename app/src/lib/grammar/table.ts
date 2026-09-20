/** The table generator: one tense of one verb the learner knows, as an
 *  exercise on the rule that builds it (GRAMMAR.md, "Generators, faces,
 *  and how many at once").
 *
 *  The rule says what the endings are and what the stem is; the verb's own
 *  table, from the catalogue, says what the forms are. Where the two agree
 *  a cell observes the rule's ending; where the verb goes its own way in a
 *  cell — *nous plongeons*, *j'appelle* — that cell is the verb's own item
 *  too, on the stem, so a slip there grades the verb's form card and not
 *  the rule (grammar/grade.ts). A verb whose table mostly does not follow
 *  the rule is not an instance of it at all: *partir* is not a *finir*, and
 *  *prendre* is not a *vendre*.
 */
import type { Conjugation, ConjugationGroup, StudyWord } from '../model.js';
import type { WordKey } from '../keys.js';
import { itemRef } from './grade.js';
import type { Cell, Instance } from './instance.js';
import type { RuleId } from './rules.js';

/** The generator's analyser version, on every attempt it labels. Bump it
 *  when what a cell is said to observe changes. */
export const TABLE_GENV = 1;

/** A rule a table can drill: the tense, the infinitive ending it is for,
 *  and its six endings in table order (je, tu, il, nous, vous, ils). */
export interface TableRule {
  rule: RuleId;
  tense: string;
  /** What the infinitive ends in; the stem is the rest. */
  infinitive: string;
  endings: readonly [string, string, string, string, string, string];
}

/** The rules with a table generator today: the three regular présent
 *  groups. A rule not here has no table, whatever its faces say. */
export const TABLE_RULES: readonly TableRule[] = [
  { rule: 'V.pres-er', tense: 'pres', infinitive: 'er', endings: ['e', 'es', 'e', 'ons', 'ez', 'ent'] },
  { rule: 'V.pres-ir', tense: 'pres', infinitive: 'ir', endings: ['is', 'is', 'it', 'issons', 'issez', 'issent'] },
  { rule: 'V.pres-re', tense: 'pres', infinitive: 're', endings: ['s', 's', '', 'ons', 'ez', 'ent'] },
];

export const tableRuleOf = (rule: string): TableRule | null =>
  TABLE_RULES.find((r) => r.rule === rule) ?? null;

/** Rules that have a table to deal. */
export const TABLE_RULE_IDS: readonly RuleId[] = TABLE_RULES.map((r) => r.rule);

/** Cells the rule may have its own way in before the verb is no longer an
 *  instance of it: two of six. *plonger* has one (*plongeons*) and is an
 *  *-er* verb; *prendre* has three and is not a *vendre*. */
const OWN_CELLS_ALLOWED = 2;

const groupOf = (conj: Conjugation, tense: string): ConjugationGroup | null =>
  conj.groups.find((g) => g.id === tense) ?? null;

/** The table of `rule` on this verb, or null where the verb is not an
 *  instance of the rule: the wrong infinitive, no table in that tense, a
 *  form that does not end in the rule's ending, or too many cells of its
 *  own. The instance's id is the verb and the tense, so a rule's breadth
 *  counts verbs. */
export function tableFor(
  word: Pick<StudyWord, 'k' | 'en' | 'conj'>, rule: TableRule,
): Instance | null {
  const conj = word.conj;
  if (!conj || !conj.lemma.endsWith(rule.infinitive)) return null;
  const group = groupOf(conj, rule.tense);
  if (!group || group.irregular || group.rows.length !== 6) return null;
  const stem = conj.lemma.slice(0, -rule.infinitive.length);
  const cells: Cell[] = [];
  let own = 0;
  for (const [i, row] of group.rows.entries()) {
    const ending = rule.endings[i]!;
    if (!row.f || !row.f.endsWith(ending)) return null;
    const rowStem = row.f.slice(0, row.f.length - ending.length);
    const cell: Cell = {
      prompt: row.p, expected: row.f, stem: rowStem, ending,
      obs: [{ of: rule.rule, on: 'ending' }],
    };
    if (row.also?.length) cell.also = row.also;
    if (rowStem !== stem) {
      own += 1;
      cell.obs.push({ of: itemRef(word.k, rule.tense, String(i + 1)), on: 'stem' });
    }
    cells.push(cell);
  }
  if (own > OWN_CELLS_ALLOWED) return null;
  return {
    id: tableId(word.k, rule.tense), gen: 'table', face: 'gap',
    spec: { key: word.k, tense: rule.tense }, genv: TABLE_GENV, rule: rule.rule,
    title: `${conj.lemma} · ${group.tense}`, hint: word.en[0] ?? '',
    cells,
  };
}

/** The identity of a verb's table in a tense, for breadth. */
export const tableId = (key: WordKey, tense: string): string => `table:${key}:${tense}`;

/** Every table this verb is an instance of: at most one per tense today,
 *  since the infinitive endings are exclusive. */
export const tablesFor = (word: Pick<StudyWord, 'k' | 'en' | 'conj'>): Instance[] =>
  TABLE_RULES.map((r) => tableFor(word, r)).filter((t): t is Instance => t !== null);
