/** A verb form, as it is said.
 *
 *  The rule is short because the pipeline already elides the pronouns and
 *  carries the subjunctive's "que". What is left is the imperative, whose
 *  pronoun is in brackets because it is not spoken at all.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  CORE_TENSES, FIRST_TENSES, conjSlot, joinPronoun, leadOf, phrasesOf, phrasesOfGroup, readInTurn,
  spokenForm, spokenLead, tenseInOrder,
} from '../src/lib/conjspeech.js';
import type { SpokenLine } from '../src/lib/conjspeech.js';
import type { Conjugation, ConjugationGroup, ConjugationRow } from '../src/lib/model.js';

const row = (p: string, f: string): ConjugationRow =>
  ({ p, f, s: '', e: f, alt: false, dup: false });

const group = (id: string, rows: ConjugationRow[]): ConjugationGroup =>
  ({ id, mood: 'Indicatif', tense: id, stem: '', irregular: false, note: '', rows });

const conj = (groups: ConjugationGroup[]): Conjugation => ({
  lemma: 'parler', aux: 'avoir', shape: 'regular -er', groups,
  compound: [], impersonal: [], links: [], examples: {},
});

test('a pronoun that elides joins its verb without a space', () => {
  /* The table drew the pronoun as a cell of its own with a gap after it, so
     every line had a space before its verb and "j'" stood apart from "étais"
     (#58). The written line is one rule, tested as a table. */
  const table: [pronoun: string, form: string, written: string][] = [
    ["j'", 'aime', "j'aime"],
    ['je', 'parle', 'je parle'],
    ["qu'il", 'aime', "qu'il aime"],
    ["que j'", 'aie', "que j'aie"],
    ['que je', 'parle', 'que je parle'],
    ['(tu)', 'parle', '(tu) parle'],
    ['j’', 'aime', 'j’aime'],            /* the curly apostrophe too */
    ['', 'parle', 'parle'],
    [" j' ", ' aime ', "j'aime"],        /* an older catalogue's stray spaces */
    ['je', '', ''],
  ];
  for (const [pronoun, form, written] of table) {
    assert.equal(joinPronoun(pronoun, form), written, `"${pronoun}" + "${form}"`);
  }
  assert.equal(leadOf('je'), 'je ', 'the lead carries the space, where there is one');
  assert.equal(leadOf("j'"), "j'");
  assert.equal(leadOf(''), '');
});

test('what is said before the form is the written lead, except the imperative’s', () => {
  assert.equal(spokenLead(row('je', 'pars')), 'je ');
  assert.equal(spokenLead(row("j'", 'étais')), "j'");
  assert.equal(spokenLead(row('(tu)', 'sois')), '', 'a bracketed pronoun is not said');
});

test('a form is said with its pronoun, which is what makes it French', () => {
  assert.equal(spokenForm(row('je', 'parle')), 'je parle');
  assert.equal(spokenForm(row('ils', 'parlent')), 'ils parlent');
  assert.equal(spokenForm(row('que je', 'parle')), 'que je parle');
});

test('an elided pronoun runs into its verb, with no space in between', () => {
  assert.equal(spokenForm(row("j'", 'étais')), "j'étais");
  assert.equal(spokenForm(row("qu'il", 'soit')), "qu'il soit");
  assert.equal(spokenForm(row('j’', 'aime')), 'j’aime', 'the curly apostrophe too');
});

test('the imperative’s pronoun is written, not said', () => {
  /* "(tu) sois" is how the table says that the form stands alone. */
  assert.equal(spokenForm(row('(tu)', 'sois')), 'sois');
  assert.equal(spokenForm(row('(vous)', 'soyez')), 'soyez');
});

test('a row with nothing in it is said as nothing', () => {
  assert.equal(spokenForm(null), '');
  assert.equal(spokenForm(row('je', '')), '');
  assert.equal(spokenForm(row('', 'parle')), 'parle', 'a form with no pronoun is still a form');
});

test('every line of a tense gets a slot of its own, by its place in it', () => {
  const phrases = phrasesOfGroup('parler|verb', group('pres', [row('je', 'parle'), row('tu', 'parles')]));
  assert.deepEqual(phrases, [
    { key: 'parler|verb', slot: 'conj:pres:0', text: 'je parle' },
    { key: 'parler|verb', slot: 'conj:pres:1', text: 'tu parles' },
  ]);
  assert.equal(conjSlot('imp', 3), 'conj:imp:3');
});

test('only the tenses asked for are prepared', () => {
  const table = conj([
    group('pres', [row('je', 'parle')]),
    group('imp', [row('je', 'parlais')]),
    group('pqp', [row('je', 'parlasse')]),
  ]);
  assert.equal(phrasesOf('parler|verb', table).length, 3, 'all of them by default');
  assert.deepEqual(phrasesOf('parler|verb', table, FIRST_TENSES).map((p) => p.text),
    ['je parle']);
  assert.deepEqual(phrasesOf('parler|verb', table, CORE_TENSES).map((p) => p.text),
    ['je parle', 'je parlais'], 'the literary tense is not made on a guess');
  assert.deepEqual(phrasesOf('parler|verb', null), [], 'a word that is not a verb has none');
});

const PRESENT = group('pres', [
  row('je', 'parle'), row('tu', 'parles'), row('il', 'parle'),
  row('nous', 'parlons'), row('vous', 'parlez'), row('ils', 'parlent'),
]);

test('a whole tense is said one person at a time, in the order the table shows', () => {
  /* The table draws two columns, je/tu/il and nous/vous/ils; read down the
     first and then the second it is the order the pipeline wrote the rows
     in, and the order the button says them in (#49). */
  const lines = tenseInOrder('parler|verb', PRESENT);
  assert.deepEqual(lines.map((l) => l.phrase.text),
    ['je parle', 'tu parles', 'il parle', 'nous parlons', 'vous parlez', 'ils parlent']);
  assert.deepEqual(lines.map((l) => l.row), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(lines.map((l) => l.phrase.slot), [0, 1, 2, 3, 4, 5].map((i) => conjSlot('pres', i)),
    'a line read is the clip the hover finds ready');
  assert.deepEqual(phrasesOfGroup('parler|verb', PRESENT), lines.map((l) => l.phrase),
    'the reading and the warm-up are one list');
});

test('a row with nothing in it is skipped, and the rest keep their places', () => {
  /* The imperative has three rows in six places; the gaps are not pauses,
     and "(tu)" is not said. */
  const rows: (ConjugationRow | null)[] = [null, row('(tu)', 'parle'), null, row('(nous)', 'parlons'),
    row('(vous)', 'parlez'), null];
  const lines = tenseInOrder('parler|verb', group('imper', rows as ConjugationRow[]));
  assert.deepEqual(lines.map((l) => [l.row, l.phrase.text]),
    [[1, 'parle'], [3, 'parlons'], [4, 'parlez']]);
});

/** A voice whose every line the test lets finish, one at a time. */
function slowVoice(): {
  say: (line: SpokenLine) => Promise<boolean>;
  asked: string[];
  finish: (heard?: boolean) => void;
} {
  const asked: string[] = [];
  const pending: ((heard: boolean) => void)[] = [];
  return {
    asked,
    say: (line) => new Promise<boolean>((resolve) => {
      asked.push(line.phrase.text);
      pending.push(resolve);
    }),
    finish: (heard = true) => { pending.shift()?.(heard); },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

test('the next line starts only when the last has finished', async () => {
  const voice = slowVoice();
  const marked: (number | null)[] = [];
  const reading = readInTurn(tenseInOrder('parler|verb', PRESENT), voice.say,
    (line) => marked.push(line?.row ?? null));
  await tick();
  assert.deepEqual(voice.asked, ['je parle'], 'one voice at a time');
  voice.finish();
  await tick();
  assert.deepEqual(voice.asked, ['je parle', 'tu parles']);
  for (let n = 0; n < 5; n += 1) { voice.finish(); await tick(); }
  assert.equal(await reading.done, true);
  assert.equal(voice.asked.length, 6);
  assert.deepEqual(marked, [0, 1, 2, 3, 4, 5, null], 'the screen is told each line, then that it is over');
});

test('stopping a reading ends it, and what was still to come is never asked for', async () => {
  const voice = slowVoice();
  const marked: (number | null)[] = [];
  const reading = readInTurn(tenseInOrder('parler|verb', PRESENT), voice.say,
    (line) => marked.push(line?.row ?? null));
  await tick();
  voice.finish();
  await tick();
  reading.stop();
  voice.finish();                     /* the line being said is cut short by the player */
  assert.equal(await reading.done, false);
  assert.deepEqual(voice.asked, ['je parle', 'tu parles']);
  assert.deepEqual(marked, [0, 1, null]);
});

test('a line nothing can sound ends the reading', async () => {
  /* No clip and no voice: the player returns at once with nothing heard, and
     a reading that went on would be six silent turns behind a lit button. */
  const voice = slowVoice();
  const reading = readInTurn(tenseInOrder('parler|verb', PRESENT), voice.say);
  await tick();
  voice.finish(false);
  assert.equal(await reading.done, false);
  assert.deepEqual(voice.asked, ['je parle']);
  assert.equal(await readInTurn([], voice.say).done, true, 'nothing to say is said in full');
});
