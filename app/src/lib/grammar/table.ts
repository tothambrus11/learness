/** The table generator: one tense of one verb the learner knows, as an
 *  exercise on the rule that builds it (GRAMMAR.md, "Generators, faces,
 *  and how many at once").
 *
 *  The rule says what the endings are and where the stem comes from — the
 *  infinitive, the présent's *nous* form; the verb's own table, from the
 *  catalogue, says what the forms are. Where the two agree
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

/** A rule a table can drill: the tense, where its stem comes from, and its
 *  six endings in table order (je, tu, il, nous, vous, ils). */
export interface TableRule {
  rule: RuleId;
  tense: string;
  /** The stem the rule builds on, from the verb's own table — one for the
   *  six cells, or one per cell where the rule changes it by person (*je
   *  pars, nous partons*) — or null where the verb has nothing to build it
   *  from, or is not one of the rule's verbs. */
  stem: (conj: Conjugation) => string | Stems | null;
  endings: readonly [string, string, string, string, string, string];
  /** An item table: the verbs are learned as themselves, and every cell is
   *  the rule's on the whole form, never on a stem and an ending. Cells of
   *  the verb's own are then not counted against it. */
  items?: boolean;
}

export type Stems = readonly [string, string, string, string, string, string];

/** The infinitive minus its ending, for a verb whose infinitive has it. */
const infinitiveStem = (ending: string) => (conj: Conjugation): string | null =>
  (conj.lemma.endsWith(ending) ? conj.lemma.slice(0, -ending.length) : null);

/** The présent's *nous* form minus *-ons*: the imparfait's stem. */
const nousStem = (conj: Conjugation): string | null => {
  const nous = conj.groups.find((g) => g.id === 'pres')?.rows[3]?.f ?? '';
  return nous.endsWith('ons') ? nous.slice(0, -3) : null;
};

/** The infinitive, minus a final *e* for *-re* verbs: the futur's stem, and
 *  the conditionnel's. */
const futureStem = (conj: Conjugation): string | null =>
  (/(er|ir|re)$/.test(conj.lemma) ? conj.lemma.replace(/e$/, '') : null);

const IMPARFAIT = ['ais', 'ais', 'ait', 'ions', 'iez', 'aient'] as const;

/** *partir, sortir, dormir, servir, sentir, mentir*: the infinitive's stem
 *  loses its last consonant in the singular. */
const TIR_VERBS = new Set(['partir', 'sortir', 'dormir', 'servir', 'sentir', 'mentir', 'repartir',
  'ressortir', 'endormir', 'ressentir', 'desservir', 'consentir']);
const tirStems = (conj: Conjugation): Stems | null => {
  if (!TIR_VERBS.has(conj.lemma)) return null;
  const full = conj.lemma.slice(0, -2);
  const short = full.slice(0, -1);
  return [short, short, short, full, full, full];
};

/** *ouvrir, offrir, souffrir, découvrir, couvrir, cueillir, accueillir*:
 *  *-er* endings on the infinitive's stem. */
const OUVRIR_VERBS = new Set(['ouvrir', 'offrir', 'souffrir', 'découvrir', 'couvrir', 'recouvrir',
  'cueillir', 'accueillir', 'recueillir', 'entrouvrir']);
const ouvrirStem = (conj: Conjugation): string | null =>
  (OUVRIR_VERBS.has(conj.lemma) ? conj.lemma.slice(0, -2) : null);

/** The verbs learned as themselves: the whole form is the cell. */
const only = (lemmas: readonly string[]) => (conj: Conjugation): string | null =>
  (lemmas.includes(conj.lemma) ? '' : null);
const WHOLE = ['', '', '', '', '', ''] as const;

/** The rules with a table generator today: the regular présent groups and
 *  the two small ones beside them, the four verbs learned as themselves,
 *  and the three tenses built on a stem the verb's own table gives. A
 *  rule not here has no table, whatever its faces say. */
export const TABLE_RULES: readonly TableRule[] = [
  { rule: 'V.pres-er', tense: 'pres', stem: infinitiveStem('er'), endings: ['e', 'es', 'e', 'ons', 'ez', 'ent'] },
  { rule: 'V.pres-ir', tense: 'pres', stem: infinitiveStem('ir'), endings: ['is', 'is', 'it', 'issons', 'issez', 'issent'] },
  { rule: 'V.pres-re', tense: 'pres', stem: infinitiveStem('re'), endings: ['s', 's', '', 'ons', 'ez', 'ent'] },
  { rule: 'V.pres-tir', tense: 'pres', stem: tirStems, endings: ['s', 's', 't', 'ons', 'ez', 'ent'] },
  { rule: 'V.pres-ouvrir', tense: 'pres', stem: ouvrirStem, endings: ['e', 'es', 'e', 'ons', 'ez', 'ent'] },
  { rule: 'V.pres-etre-avoir', tense: 'pres', stem: only(['être', 'avoir']), endings: WHOLE, items: true },
  { rule: 'V.pres-aller-faire', tense: 'pres', stem: only(['aller', 'faire']), endings: WHOLE, items: true },
  { rule: 'V.imparfait', tense: 'imp', stem: nousStem, endings: IMPARFAIT },
  { rule: 'V.futur', tense: 'fut', stem: futureStem, endings: ['ai', 'as', 'a', 'ons', 'ez', 'ont'] },
  { rule: 'V.conditionnel', tense: 'cond', stem: futureStem, endings: IMPARFAIT },
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
 *  instance of the rule: nothing to build the stem from, no table in that
 *  tense, a form that does not end in the rule's ending, or too many cells
 *  of its own — which is how *être* stays out of the imparfait drill and
 *  *avoir* out of the futur's: their stems are items of other bits. The
 *  instance's id is the verb and the tense, so a rule's breadth counts
 *  verbs. */
export function tableFor(
  word: Pick<StudyWord, 'k' | 'en' | 'conj'>, rule: TableRule,
): Instance | null {
  const conj = word.conj;
  const stem = conj ? rule.stem(conj) : null;
  if (!conj || stem === null) return null;
  const group = groupOf(conj, rule.tense);
  /* An item table is the verb as it is, irregular by definition. */
  if (!group || (group.irregular && !rule.items) || group.rows.length !== 6) return null;
  const cells: Cell[] = [];
  let own = 0;
  for (const [i, row] of group.rows.entries()) {
    if (!row.f) return null;
    if (rule.items) {
      const cell: Cell = { prompt: row.p, expected: row.f, obs: [{ of: rule.rule, on: 'form' }] };
      if (row.also?.length) cell.also = row.also;
      cells.push(cell);
      continue;
    }
    const ending = rule.endings[i]!;
    if (!row.f.endsWith(ending)) return null;
    const rowStem = row.f.slice(0, row.f.length - ending.length);
    const cell: Cell = {
      prompt: row.p, expected: row.f, stem: rowStem, ending,
      obs: [{ of: rule.rule, on: 'ending' }],
    };
    if (row.also?.length) cell.also = row.also;
    if (rowStem !== (typeof stem === 'string' ? stem : stem[i])) {
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

/** Every table this verb is an instance of: at most one per tense, since
 *  the présent's rules are told apart by the infinitive or by the verb. */
export const tablesFor = (word: Pick<StudyWord, 'k' | 'en' | 'conj'>): Instance[] =>
  TABLE_RULES.map((r) => tableFor(word, r)).filter((t): t is Instance => t !== null);
