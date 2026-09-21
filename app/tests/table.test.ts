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
  assert.deepEqual(tablesFor(verb(partir)).map((t) => t.rule), ['V.pres-tir'], 'partir has a rule of its own');
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
  const broken = present('boire', ['bois', 'bois', 'boit', 'buvons', 'buvez', 'boivent']);
  broken.groups[0]!.irregular = true;
  assert.deepEqual(tablesFor(verb(broken)), [], 'a two-stem verb of the voir / croire / boire bit has no table yet');
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

test('the imparfait is built on the présent’s nous stem, and être, whose stem is its own, is not an instance', () => {
  const withImp = (conj: Conjugation, forms: string[]): Conjugation => ({
    ...conj,
    groups: [...conj.groups, { ...present('x', forms).groups[0]!, id: 'imp', tense: 'Imparfait' }],
  });
  const fin = withImp(finir, ['finissais', 'finissais', 'finissait', 'finissions', 'finissiez', 'finissaient']);
  const t = tableFor(verb(fin), tableRuleOf('V.imparfait')!);
  assert.ok(t);
  assert.equal(t.id, 'table:finir|verb:imp');
  assert.equal(t.title, 'finir · Imparfait');
  assert.deepEqual(t.cells.map((c) => [c.stem, c.ending]).slice(0, 4),
    [['finiss', 'ais'], ['finiss', 'ais'], ['finiss', 'ait'], ['finiss', 'ions']]);
  for (const c of t.cells) assert.deepEqual(c.obs, [{ of: 'V.imparfait', on: 'ending' }]);
  const pren = withImp(prendre, ['prenais', 'prenais', 'prenait', 'prenions', 'preniez', 'prenaient']);
  assert.ok(tableFor(verb(pren), tableRuleOf('V.imparfait')!), 'prendre is regular here: nous prenons gives pren-');
  const etre = withImp(present('être', ['suis', 'es', 'est', 'sommes', 'êtes', 'sont']),
    ['étais', 'étais', 'était', 'étions', 'étiez', 'étaient']);
  assert.equal(tableFor(verb(etre), tableRuleOf('V.imparfait')!), null, 'ét- is not somm-: six cells of its own');
  assert.equal(tableFor(verb(finir), tableRuleOf('V.imparfait')!), null, 'no imparfait table shipped');
});

test('the futur and the conditionnel are built on the infinitive, an -re verb dropping its e; an irregular stem is not an instance', () => {
  const withTense = (conj: Conjugation, id: string, tense: string, forms: string[]): Conjugation => ({
    ...conj, groups: [...conj.groups, { ...present('x', forms).groups[0]!, id, tense }],
  });
  const vend = withTense(vendre, 'fut', 'Futur simple', ['vendrai', 'vendras', 'vendra', 'vendrons', 'vendrez', 'vendront']);
  const fut = tableFor(verb(vend), tableRuleOf('V.futur')!);
  assert.deepEqual(fut?.cells.map((c) => c.stem), Array(6).fill('vendr'));
  assert.deepEqual(fut?.cells.map((c) => c.ending), ['ai', 'as', 'a', 'ons', 'ez', 'ont']);
  const parl = withTense(parler, 'cond', 'Présent', ['parlerais', 'parlerais', 'parlerait', 'parlerions', 'parleriez', 'parleraient']);
  const cond = tableFor(verb(parl), tableRuleOf('V.conditionnel')!);
  assert.deepEqual(cond?.cells.map((c) => c.expected), ['parlerais', 'parlerais', 'parlerait', 'parlerions', 'parleriez', 'parleraient']);
  assert.equal(cond?.rule, 'V.conditionnel');
  const avoir = withTense(present('avoir', ['ai', 'as', 'a', 'avons', 'avez', 'ont']), 'fut', 'Futur simple',
    ['aurai', 'auras', 'aura', 'aurons', 'aurez', 'auront']);
  assert.equal(tableFor(verb(avoir), tableRuleOf('V.futur')!), null, 'aur- is an item of another bit');
  assert.deepEqual(tablesFor(verb(vend)).map((t) => t.id), ['table:vendre|verb:pres', 'table:vendre|verb:fut'],
    'one table per tense the verb has');
});

test('partir loses a consonant in the singular, ouvrir takes the -er endings, and neither is a plain -ir', () => {
  const t = tableFor(verb(partir), tableRuleOf('V.pres-tir')!);
  assert.ok(t);
  assert.deepEqual(t.cells.map((c) => [c.stem, c.ending]), [['par', 's'], ['par', 's'], ['par', 't'],
    ['part', 'ons'], ['part', 'ez'], ['part', 'ent']]);
  for (const c of t.cells) assert.deepEqual(c.obs, [{ of: 'V.pres-tir', on: 'ending' }], 'nothing of its own: the rule says the stems');
  assert.deepEqual(tablesFor(verb(partir)).map((i) => i.rule), ['V.pres-tir']);
  const ouvrir = present('ouvrir', ['ouvre', 'ouvres', 'ouvre', 'ouvrons', 'ouvrez', 'ouvrent']);
  assert.deepEqual(tablesFor(verb(ouvrir)).map((i) => i.rule), ['V.pres-ouvrir']);
  assert.equal(tableFor(verb(finir), tableRuleOf('V.pres-tir')!), null, 'finir is not one of them');
  assert.equal(tableFor(verb(finir), tableRuleOf('V.pres-ouvrir')!), null);
});

test('être, avoir, aller and faire are item tables: the whole form is the cell, irregular by definition', () => {
  const etre = present('être', ['suis', 'es', 'est', 'sommes', 'êtes', 'sont']);
  etre.groups[0]!.irregular = true;
  const t = tableFor(verb(etre), tableRuleOf('V.pres-etre-avoir')!);
  assert.ok(t);
  assert.deepEqual(t.cells.map((c) => c.expected), ['suis', 'es', 'est', 'sommes', 'êtes', 'sont']);
  assert.deepEqual(t.cells[3]?.obs, [{ of: 'V.pres-etre-avoir', on: 'form' }]);
  assert.equal(t.cells[3]?.stem, undefined, 'no stem and no ending to blame apart');
  const aller = present('aller', ['vais', 'vas', 'va', 'allons', 'allez', 'vont']);
  assert.deepEqual(tablesFor(verb(aller)).map((i) => i.rule), ['V.pres-aller-faire'],
    'and not an -er verb, whatever its infinitive ends in');
  assert.equal(tableFor(verb(parler), tableRuleOf('V.pres-etre-avoir')!), null);
});

test('the passé composé of an avoir verb is six cells of two words, each word its own rule’s', async () => {
  const { compoundFor, compoundRuleOf } = await import('../src/lib/grammar/table.js');
  const { answerCells } = await import('../src/lib/grammar/instance.js');
  const withPc = (conj: Conjugation, aux: 'avoir' | 'être', participle: string): Conjugation => ({
    ...conj,
    compound: [{ id: 'pc', label: 'Passé composé', aux, aux_key: 'pres', aux_form: aux === 'avoir' ? 'ai' : 'suis',
      participle, example: '', why: '', agrees: aux === 'être' }],
  });
  const t = compoundFor(verb(withPc(parler, 'avoir', 'parlé'), 'to speak'), compoundRuleOf('V.pc')!);
  assert.ok(t);
  assert.equal(t.id, 'table:parler|verb:pc');
  assert.equal(t.title, 'parler · Passé composé');
  assert.deepEqual(t.cells.map((c) => [c.prompt, c.expected]), [["j'", 'ai parlé'], ['tu', 'as parlé'], ['il', 'a parlé'],
    ['nous', 'avons parlé'], ['vous', 'avez parlé'], ['ils', 'ont parlé']]);
  const judge = (typed: string) => Object.fromEntries(answerCells(t, [typed])[0]!.obs.map((o) => [o.of, o.ok]));
  assert.deepEqual(judge('ai parlé'), { 'V.pc': true, 'V.pres-etre-avoir': true, 'V.participle': true });
  assert.deepEqual(judge('ai parler'), { 'V.pc': false, 'V.pres-etre-avoir': true, 'V.participle': false },
    'the infinitive for the participle is the participle rule, not avoir');
  assert.deepEqual(judge('a parlé'), { 'V.pc': false, 'V.pres-etre-avoir': false, 'V.participle': true });
  assert.equal(compoundFor(verb(withPc(partir, 'être', 'parti')), compoundRuleOf('V.pc')!), null,
    'with être the participle agrees: another bit');
  assert.equal(compoundFor(verb(parler), compoundRuleOf('V.pc')!), null, 'no compound shipped');
  assert.deepEqual(tablesFor(verb(withPc(parler, 'avoir', 'parlé'))).map((i) => i.id),
    ['table:parler|verb:pres', 'table:parler|verb:pc']);
});

test('the modals, venir and savoir are item tables of their own, and only for their verbs', () => {
  const pouvoir = present('pouvoir', ['peux', 'peux', 'peut', 'pouvons', 'pouvez', 'peuvent']);
  pouvoir.groups[0]!.irregular = true;
  assert.deepEqual(tablesFor(verb(pouvoir)).map((i) => i.rule), ['V.pres-modals']);
  const venir = present('venir', ['viens', 'viens', 'vient', 'venons', 'venez', 'viennent']);
  assert.deepEqual(tablesFor(verb(venir)).map((i) => i.rule), ['V.pres-venir'], 'not partir’s, though it ends in -ir');
  const savoir = present('savoir', ['sais', 'sais', 'sait', 'savons', 'savez', 'savent']);
  assert.deepEqual(tablesFor(verb(savoir)).map((i) => i.rule), ['V.pres-savoir-connaitre']);
  assert.deepEqual(tablesFor(verb(savoir))[0]?.cells[2]?.obs, [{ of: 'V.pres-savoir-connaitre', on: 'form' }]);
});

test('once a rule is passed its tables are kept one form at a time, the same cell with the same labels', async () => {
  const { formsFor, allFormsFor } = await import('../src/lib/grammar/table.js');
  const forms = formsFor(verb(plonger, 'to dive'), tableRuleOf('V.pres-er')!);
  assert.equal(forms.length, 6);
  assert.equal(forms[3]?.id, 'form:plonger|verb:pres:4');
  assert.equal(forms[3]?.gen, 'form');
  assert.equal(forms[3]?.title, 'plonger · Présent');
  assert.deepEqual(forms[3]?.spec, { key: 'plonger|verb', tense: 'pres', person: 4 });
  assert.deepEqual(forms[3]?.cells, [tableFor(verb(plonger), tableRuleOf('V.pres-er')!)!.cells[3]],
    'the table’s own cell, obs and all');
  assert.equal(formsFor(verb(finir), tableRuleOf('V.pres-er')!).length, 0, 'no table, no forms');
  assert.equal(allFormsFor(verb(parler)).length, 12, 'one table today, typed and said');
  assert.equal(allFormsFor(verb(parler)).filter((f) => f.face === 'say').length, 6);
  const said = formsFor(verb(parler), tableRuleOf('V.pres-er')!, 'say')[3]!;
  assert.equal(said.id, 'say:form:parler|verb:pres:4');
  assert.equal(said.title, 'nous · parler · Présent');
  assert.equal(said.speech?.text, 'nous parlons');
  assert.equal(said.cells[0]?.say, true);
});
