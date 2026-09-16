/** A verb form, as it is said.
 *
 *  The rule is short because the pipeline already elides the pronouns and
 *  carries the subjunctive's "que". What is left is the imperative, whose
 *  pronoun is in brackets because it is not spoken at all.
 */
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  CORE_TENSES, FIRST_TENSES, conjSlot, joinPronoun, leadOf, pauseAfter, pauseRule, phrasesOf,
  phrasesOfGroup, readInTurn, spokenForm, spokenLead, tenseInOrder,
} from '../src/lib/conjspeech.js';
import type { PauseRule, SpokenLine } from '../src/lib/conjspeech.js';
import type { Conjugation, ConjugationGroup, ConjugationRow, FormGap } from '../src/lib/model.js';

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

/** A voice whose every line the test lets finish, one at a time: heard,
 *  and a second long, unless the test says otherwise. */
function slowVoice(): {
  say: (line: SpokenLine) => Promise<number | null>;
  asked: string[];
  finish: (heard?: boolean, ms?: number) => void;
} {
  const asked: string[] = [];
  const pending: ((ranMs: number | null) => void)[] = [];
  return {
    asked,
    say: (line) => new Promise<number | null>((resolve) => {
      asked.push(line.phrase.text);
      pending.push(resolve);
    }),
    finish: (heard = true, ms = 1000) => { pending.shift()?.(heard ? ms : null); },
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

test('the pause after a line is what the setting says, and nothing by default', () => {
  /* The learner asked for the gap they had heard to become a setting: none,
     a fixed time, or the length of the line — "max is what should be taken
     of the two" (#60). One rule, tested as a table. */
  const table: [gap: FormGap | null | undefined, prev: number | null, next: number | null,
    pause: number][] = [
    [{ mode: 'fixed', ms: 0 }, 900, 1200, 0],
    [undefined, 900, 1200, 0],           /* a device from before the setting */
    [null, 900, 1200, 0],
    [{ mode: 'fixed', ms: 1500 }, 900, 1200, 1500],
    [{ mode: 'fixed', ms: 1500 }, null, null, 1500],   /* a fixed pause needs no lengths */
    [{ mode: 'fixed', ms: -5 }, 900, 1200, 0],         /* never negative, whatever was stored */
    [{ mode: 'echo' }, 900, 1200, 1200],
    [{ mode: 'echo' }, 1400, 1200, 1400],
    [{ mode: 'echo' }, 900, null, 900],  /* the next line is the browser's: unmeasured */
    [{ mode: 'echo' }, null, 1200, 1200],
    [{ mode: 'echo' }, null, null, 0],
  ];
  for (const [gap, prev, next, pause] of table) {
    assert.equal(pauseAfter(gap, prev, next), pause, `${JSON.stringify(gap)} after ${prev} before ${next}`);
  }
});

test('a reading pauses between lines for as long as the setting says, and not by default', async () => {
  /* The seconds between lines were never a setting: they were the next clip
     being made (#60). With no pause set the next line is asked for the moment
     this one ends; with one set, that long after — counted from the end of
     the line, so a clip that took a while to arrive is not waited on twice. */
  vi.useFakeTimers();
  try {
    const advance = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };
    const voice = slowVoice();
    readInTurn(tenseInOrder('parler|verb', PRESENT), voice.say);
    await advance(0);
    voice.finish();
    await advance(0);
    assert.deepEqual(voice.asked, ['je parle', 'tu parles'], 'no pause: the next line at once');

    const paused = slowVoice();
    const asked: [number | null, string][] = [];
    const pause: PauseRule = (prev, next) => { asked.push([prev, next.phrase.text]); return 1500; };
    readInTurn(tenseInOrder('parler|verb', PRESENT), paused.say, () => {}, pause);
    await advance(0);
    paused.finish(true, 800);
    await advance(1400);
    assert.deepEqual(paused.asked, ['je parle'], 'a second and a bit in, still waiting');
    await advance(100);
    assert.deepEqual(paused.asked, ['je parle', 'tu parles'], 'and at a second and a half, the next');
    assert.deepEqual(asked, [[800, 'tu parles']], 'the rule was told how long the line ran, and what follows');

    /* A pause the rule itself spent waiting on — the next clip — is part of
       the pause, not added to it. */
    const late = slowVoice();
    const slowRule: PauseRule = () => new Promise((resolve) => { setTimeout(() => resolve(1500), 1000); });
    readInTurn(tenseInOrder('parler|verb', PRESENT), late.say, () => {}, slowRule);
    await advance(0);
    late.finish();
    await advance(1400);
    assert.deepEqual(late.asked, ['je parle']);
    await advance(100);
    assert.deepEqual(late.asked, ['je parle', 'tu parles'], 'a second and a half after the line, not two and a half');
  } finally {
    vi.useRealTimers();
  }
});

test('the line just said stays marked through the pause, and a stopped reading does not wait it out', async () => {
  vi.useFakeTimers();
  try {
    const voice = slowVoice();
    const marked: (number | null)[] = [];
    const reading = readInTurn(tenseInOrder('parler|verb', PRESENT), voice.say,
      (line) => marked.push(line?.row ?? null), () => 5000);
    await vi.advanceTimersByTimeAsync(0);
    voice.finish();
    await vi.advanceTimersByTimeAsync(1000);
    assert.deepEqual(marked, [0], 'the first line, still: it is the one to say back');
    reading.stop();
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(await reading.done, false);
    assert.deepEqual(marked, [0, null], 'over at once, not four seconds later');
    assert.deepEqual(voice.asked, ['je parle']);
  } finally {
    vi.useRealTimers();
  }
});

test('the setting as a rule asks how long the next line runs, and waits to be told', async () => {
  /* Asking is waiting for the clip, whatever the setting: a fixed pause has
     no use for the length, but a clip waited for here is one the play after
     the pause finds ready rather than makes in a silence of its own. */
  const lines = tenseInOrder('parler|verb', PRESENT);
  const lengths: string[] = [];
  const lengthOf = async (line: SpokenLine): Promise<number | null> => {
    lengths.push(line.phrase.text);
    return line.row === 1 ? 1300 : null;
  };
  assert.equal(await pauseRule({ mode: 'echo' }, lengthOf)(900, lines[1]!), 1300);
  assert.equal(await pauseRule({ mode: 'echo' }, lengthOf)(900, lines[2]!), 900, 'a line the browser will say');
  assert.equal(await pauseRule({ mode: 'fixed', ms: 0 }, lengthOf)(900, lines[1]!), 0);
  assert.deepEqual(lengths, ['tu parles', 'il parle', 'tu parles']);
});
