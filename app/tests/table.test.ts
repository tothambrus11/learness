/** The table generator: which rule a verb's table drills, what each cell
 *  observes, and which verbs are not instances of a rule at all.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { TABLE_RULES, tableFor, tableId, tableRuleOf, tablesFor } from '../src/lib/grammar/table.js';
import { isRuleId } from '../src/lib/grammar/rules.js';
import type { Conjugation } from '../src/lib/model.js';
import { k, word } from './make.js';

/** A présent table from six forms, split the way the pipeline splits them:
 *  the longest shared prefix as the stem, the rest as endings. */
function present(lemma: string, forms: string[], over: Partial<Conjugation> = {}): Conjugation {
  const stem = forms.reduce((a, f) => { let i = 0; while (i < a.length && a[i] === f[i]) i += 1; return a.slice(0, i); });
  const pron = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];
  return {
    lemma, aux: 'avoir', shape: '', compound: [], impersonal: [], links: [], examples: {},
    groups: [{ id: 'pres', mood: '', tense: 'Présent', stem, irregular: false, note: '',
      rows: forms.map((f, i) => ({ p: pron[i]!, s: stem, e: f.slice(stem.length), f })) }],
    ...over,
  };
}
const parler = present('parler', ['parle', 'parles', 'parle', 'parlons', 'parlez', 'parlent']);
const finir = present('finir', ['finis', 'finis', 'finit', 'finissons', 'finissez', 'finissent']);
const vendre = present('vendre', ['vends', 'vends', 'vend', 'vendons', 'vendez', 'vendent']);
const partir = present('partir', ['pars', 'pars', 'part', 'partons', 'partez', 'partent']);
const prendre = present('prendre', ['prends', 'prends', 'prend', 'prenons', 'prenez', 'prennent']);
const plonger = present('plonger', ['plonge', 'plonges', 'plonge', 'plongeons', 'plongez', 'plongent']);
const verb = (conj: Conjugation, en = 'to do') =>
  word({ k: `${conj.lemma}|verb`, fr: conj.lemma, lemma: conj.lemma, pos: 'verb', en: [en], conj });

test('a regular -er verb is a table of the -er rule: six cells, each observing the ending', () => {
  const t = tableFor(verb(parler, 'to speak'), tableRuleOf('V.pres-er')!);
  assert.ok(t);
  assert.equal(t.id, 'table:parler|verb:pres');
  assert.equal(t.rule, 'V.pres-er');
  assert.equal(t.title, 'parler · Présent');
  assert.equal(t.hint, 'to speak');
  assert.deepEqual(t.spec, { key: 'parler|verb', tense: 'pres' });
  assert.deepEqual(t.cells.map((c) => [c.prompt, c.expected, c.stem, c.ending]), [
    ['je', 'parle', 'parl', 'e'], ['tu', 'parles', 'parl', 'es'], ['il', 'parle', 'parl', 'e'],
    ['nous', 'parlons', 'parl', 'ons'], ['vous', 'parlez', 'parl', 'ez'], ['ils', 'parlent', 'parl', 'ent'],
  ]);
  for (const c of t.cells) assert.deepEqual(c.obs, [{ of: 'V.pres-er', on: 'ending' }]);
});

test('finir is a table of the -ir rule and vendre of the -re rule, on the rule’s own endings', () => {
  const ir = tableFor(verb(finir), tableRuleOf('V.pres-ir')!);
  assert.deepEqual(ir?.cells.map((c) => c.ending), ['is', 'is', 'it', 'issons', 'issez', 'issent'],
    'the rule’s endings, not the pipeline’s split at *fini-*');
  assert.deepEqual(ir?.cells.map((c) => c.stem), Array(6).fill('fin'));
  const re = tableFor(verb(vendre), tableRuleOf('V.pres-re')!);
  assert.deepEqual(re?.cells.map((c) => c.expected), ['vends', 'vends', 'vend', 'vendons', 'vendez', 'vendent']);
  assert.equal(re?.cells[2]?.ending, '', 'il vend: no ending at all');
});

test('a verb whose table mostly goes its own way is not an instance of the rule', () => {
  assert.equal(tableFor(verb(partir), tableRuleOf('V.pres-ir')!), null, 'je pars is not je partis');
  assert.equal(tableFor(verb(prendre), tableRuleOf('V.pres-re')!), null, 'three cells of its own');
  assert.equal(tableFor(verb(parler), tableRuleOf('V.pres-ir')!), null, 'the wrong infinitive');
  assert.deepEqual(tablesFor(verb(partir)), [], 'no rule today has a table for partir');
  assert.deepEqual(tablesFor(verb(parler)).map((t) => t.rule), ['V.pres-er']);
});

test('a cell where the verb goes its own way is the verb’s own item too, on the stem', () => {
  const t = tableFor(verb(plonger), tableRuleOf('V.pres-er')!);
  assert.ok(t, 'one cell of its own is still an -er verb');
  const nous = t.cells[3]!;
  assert.equal(nous.stem, 'plonge');
  assert.deepEqual(nous.obs, [{ of: 'V.pres-er', on: 'ending' }, { of: 'item:plonger|verb:pres:4', on: 'stem' }]);
  assert.deepEqual(t.cells[0]?.obs, [{ of: 'V.pres-er', on: 'ending' }], 'the other cells are the rule’s alone');
});

test('a verb with no table, or an irregular one, is nothing to deal', () => {
  assert.deepEqual(tablesFor(word({ k: 'bug|noun' })), []);
  const broken = present('aller', ['vais', 'vas', 'va', 'allons', 'allez', 'vont']);
  broken.groups[0]!.irregular = true;
  assert.deepEqual(tablesFor(verb(broken)), []);
  const accepted = present('parler', ['parle', 'parles', 'parle', 'parlons', 'parlez', 'parlent']);
  accepted.groups[0]!.rows[0]!.also = ['parle aussi'];
  const t = tableFor(verb(accepted), tableRuleOf('V.pres-er')!);
  assert.deepEqual(t?.cells[0]?.also, ['parle aussi'], 'an accepted variant travels with the cell');
  /* payer's *paie / paye* is four cells of its own against *pay-*: a
     spelling-change verb, which is V.pres-spelling's, not a plain -er. */
  const payer = present('payer', ['paie', 'paies', 'paie', 'payons', 'payez', 'paient']);
  assert.equal(tableFor(verb(payer), tableRuleOf('V.pres-er')!), null);
});

test('every rule with a table is in the registry, and the table id is the verb and the tense', () => {
  for (const r of TABLE_RULES) assert.ok(isRuleId(r.rule), r.rule);
  assert.equal(tableId(k('parler|verb'), 'pres'), 'table:parler|verb:pres');
  assert.equal(tableRuleOf('G.pas'), null);
});
