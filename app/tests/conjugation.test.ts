/** The verb table, drawn.
 *
 *  What it says is tested as data in conjspeech.test.ts; this renders the
 *  component the way SvelteKit prerenders it and checks that every line of
 *  the table reaches the page with its own button, that each tense has the
 *  speaker that reads it whole (#49), and that the rule which keeps a long
 *  form inside the card (#46) is still in the stylesheet — the scoped CSS is
 *  not in the rendered body, so that one is read from the source, the way
 *  rules.test.ts reads the tree.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import Conjugation from '../src/lib/components/Conjugation.svelte';
import { joinPronoun, tenseInOrder } from '../src/lib/conjspeech.js';
import type { Conjugation as Table, ConjugationGroup, ConjugationRow } from '../src/lib/model.js';

const SOURCE = fileURLToPath(new URL('../src/lib/components/Conjugation.svelte', import.meta.url));

const row = (p: string, s: string, e: string): ConjugationRow => ({ p, s, e, f: s + e });

/* préférer: the verb whose conditionnel left the card on a phone (#46). The
   imperative has three rows in six places, so the gaps are drawn too. */
const cond: ConjugationGroup = {
  id: 'cond', mood: 'Conditionnel', tense: 'Présent', stem: 'préférer', irregular: false, note: '',
  rows: [row('je', 'préférer', 'ais'), row('tu', 'préférer', 'ais'), row('il', 'préférer', 'ait'),
    row('nous', 'préférer', 'ions'), row('vous', 'préférer', 'iez'), row('ils', 'préférer', 'aient')],
};
const imper: ConjugationGroup = {
  id: 'imper', mood: 'Impératif', tense: 'Présent', stem: 'préf', irregular: true, note: '',
  rows: [null, row('(tu)', 'préfèr', 'e'), null, row('(nous)', 'préfér', 'ons'),
    row('(vous)', 'préfér', 'ez'), null] as ConjugationRow[],
};
/* être's imparfait and subjonctif: the rows whose pronoun elides, "j'" and
   "que j'", and "qu'il" — the lines that stood apart from their verb (#58). */
const imp: ConjugationGroup = {
  id: 'imp', mood: 'Indicatif', tense: 'Imparfait', stem: 'ét', irregular: false, note: '',
  rows: [row("j'", 'ét', 'ais'), row('tu', 'ét', 'ais'), row('il', 'ét', 'ait'),
    row('nous', 'ét', 'ions'), row('vous', 'ét', 'iez'), row('ils', 'ét', 'aient')],
};
const subj: ConjugationGroup = {
  id: 'subj', mood: 'Subjonctif', tense: 'Présent', stem: '', irregular: true, note: '',
  rows: [row("que j'", 'soi', 's'), row('que tu', 'soi', 's'), row("qu'il", 'soi', 't'),
    row('que nous', 'soy', 'ons'), row('que vous', 'soy', 'ez'), row("qu'ils", 'soi', 'ent')],
};
const table: Table = {
  lemma: 'préférer', aux: 'avoir', shape: 'é_er', groups: [cond, imper, imp, subj],
  compound: [], impersonal: [], links: [], examples: {},
};

const html = render(Conjugation, { props: { conj: table, wordKey: 'préférer|verb' } }).body;

test('every line of a tense is on the page, as a button that says it', () => {
  for (const g of table.groups) {
    for (const line of tenseInOrder('préférer|verb', g)) {
      assert.ok(html.includes(`aria-label="Hear “${line.phrase.text}”"`),
        `"${line.phrase.text}" is on the page and can be heard`);
    }
  }
  assert.equal((html.match(/class="row empty[^"]*"/g) ?? []).length, 3,
    'the imperative’s three empty places are drawn as gaps');
});

test('a pronoun that elides is drawn against its verb, with nothing between', () => {
  /* "j' étais": the pronoun was a cell beside the form, padded to a column
     and followed by a gap, so every verb sat a space or more from its
     pronoun and an elision was cut in two (#58). Now the pronoun is the
     first part of the line, inside the button that says it, and what
     follows it is leadOf's rule: the row's text is the written line and
     nothing else. */
  const rows = [...html.matchAll(/<div class="row svelte-[^"]*">([\s\S]*?)<\/div>/g)].map((m) => m[1]!);
  const written = table.groups.flatMap((g) => g.rows.filter((r) => !!r).map((r) => joinPronoun(r.p, r.f)));
  assert.equal(rows.length, written.length, 'one drawn row for every row with a form in it');
  rows.forEach((drawn, i) => {
    assert.ok(/^\s*<button[^>]*class="f[^"]*"[^>]*><span class="p[ "]/.test(drawn),
      `${written[i]}: the pronoun is inside the button, not a cell beside it`);
    assert.equal(drawn.replace(/<[^>]+>/g, '').trim(), written[i], `${written[i]}: the line and nothing else`);
  });
  assert.ok(/<span class="p[^"]*">j'<\/span>/.test(html) && /<span class="p[^"]*">je <\/span>/.test(html),
    '"j\'" has no space after it; "je" has one');
});

test('each tense has one speaker that reads it whole, named for the tense', () => {
  assert.equal((html.match(/class="hear[^"]*"/g) ?? []).length, table.groups.length);
  assert.ok(html.includes('aria-label="Hear the whole Présent"'));
});

test('a long form wraps inside its cell instead of leaving the card', () => {
  /* "ils préféreraient" ran fourteen pixels past the card on a 375px phone
     (#46): a 1fr track is never narrower than its longest line, and the line
     could not wrap. Both halves of the rule are here, and either one going
     is the form back outside the card. */
  const style = readFileSync(SOURCE, 'utf8').match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';
  const rule = (selector: string): string =>
    style.match(new RegExp(`\\n\\s*${selector.replace(/\./g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  assert.match(rule('.rows'), /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    'a column may shrink below its longest line');
  assert.match(rule('.rows.three'), /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(rule('.row'), /flex-wrap: wrap/, 'a line that does not fit goes under its pronoun');
  assert.doesNotMatch(rule('.row'), /white-space: nowrap/);
  assert.match(rule('button.f'), /overflow-wrap: anywhere/, 'and a form longer than the column breaks');
  assert.doesNotMatch(rule('.p'), /min-width/, 'the pronoun is not padded to a column (#58)');
});
