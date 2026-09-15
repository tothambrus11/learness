/** What a card puts on screen, decided away from the screen.
 *
 *  These four used to live inside the study page's template, where nothing
 *  could reach them: the sentence a card blanks, where the blank falls, which
 *  English to read out, and which senses are worth printing under an answer
 *  that already says one of them.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  anchorFor, blank, choiceFor, cueOf, lineFor, orderedBy, senses, sentenceAt, sentenceFor, tenseFor,
} from '../src/lib/cardface.js';
import { card, k as key, word } from './make.js';
import type { StudyItem } from '../src/lib/queue.js';
import type { Example } from '../src/lib/model.js';

const ex = (fr: string, f: string, en = ''): Example => ({ fr, f, en });

const item = (over: Partial<StudyItem['word']> = {}, reps = 0): StudyItem => ({
  card: card('bug|noun', 'written', 'use', { reps }),
  word: word(over),
});

test('the cue is the catalogue’s, or the first translation up to the semicolon', () => {
  assert.equal(cueOf(word({ cue: 'the day' })), 'the day');
  assert.equal(cueOf(word({ en: ['day; daytime', 'light'] })), 'day');
  assert.equal(cueOf(word({ en: [] })), '');
});

test('a card asks about the sentence its own rep count lands on', () => {
  /* Not at random: the card you look back at has to show the sentence you
     were actually asked, and the same card next week a different one. */
  const three = [ex('un', 'un'), ex('deux', 'deux'), ex('trois', 'trois')];
  assert.equal(sentenceAt(item({ ex: three }, 0)), 0);
  assert.equal(sentenceAt(item({ ex: three }, 4)), 1);
  assert.equal(sentenceFor(item({ ex: three }, 5))?.fr, 'trois');
});

test('a word with no sentences has none, and nothing asks for one', () => {
  assert.equal(sentenceAt(item({ ex: [] })), -1);
  assert.equal(sentenceFor(item({ ex: [] })), null);
  assert.equal(sentenceAt(null), -1);
  assert.equal(sentenceFor(undefined), null);
});

test('the gap is cut where the word stands, on a letter boundary', () => {
  assert.deepEqual(blank(ex('Il est parti le jour même.', 'jour')),
    { before: 'Il est parti le ', after: ' même.' });
  /* "an" inside "dans" is not the word: a blank there would ask about a
     sentence that no longer reads. */
  assert.deepEqual(blank(ex('Dans un an, peut-être.', 'an')),
    { before: 'Dans un ', after: ', peut-être.' });
  assert.deepEqual(blank(ex("C'est l'été.", 'été')),
    { before: "C'est l'", after: '.' });
});

test('a sentence whose form cannot be found is shown whole rather than blank', () => {
  assert.deepEqual(blank(ex('Il pleut.', 'neiger')), { before: 'Il pleut.', after: '' });
});

test('the senses under the answer never repeat the answer itself', () => {
  const w = word({ en: ['day', 'daylight'], def: { en: ['day, daytime', 'daylight'] } });
  assert.deepEqual(senses(w), ['day, daytime', 'daylight']);
  assert.deepEqual(senses(word({ en: ['day'], def: {} })), [], 'nothing left to say');
  assert.deepEqual(senses(null), []);
});

/* ------------------------------------------------------------- the face -- */

import { face, taskOf } from '../src/lib/cardface.js';
import type { Line } from '../src/lib/cardface.js';
import {
  CHOSEN, FORM_RUNGS, HEARD_FIRST, HEARD_RUNGS, SENSE_RUNGS, TYPED, WRITTEN_RUNGS,
} from '../src/lib/keys.js';
import type { Rung } from '../src/lib/keys.js';

const RUNGS: Rung[] = [...WRITTEN_RUNGS, ...HEARD_RUNGS];

/** A word with something distinctive in every field, so that "the French is
 *  on the card" can be asked of the text rather than of a kind. */
const full = (): StudyItem['word'] => word({
  fr: 'le bug', answer: 'le bug', gender: 'm', ipa: '/bœɡ/', en: ['bug', 'insect', 'glitch'],
  ex: [ex('Il y a un bug dans le code.', 'bug', 'There is a bug in the code.')],
});

const on = (rung: Rung, revealed: boolean, over: Partial<StudyItem['word']> = {}): Line[] =>
  face({ card: card('bug|noun', HEARD_FIRST.has(rung) ? 'heard' : 'written', rung),
    word: { ...full(), ...over } }, { revealed, typed: 'le bogue', verdict: { verdict: 'no' } });

const kinds = (lines: Line[]): string[] => lines.map((l) => l.kind);
const text = (lines: Line[]): string => lines.map((l) => ('text' in l ? l.text : '')
  + ('gap' in l ? ` ${l.before}${l.gap}${l.after}` : '')
  + ('mark' in l ? ` ${l.before}${l.mark}${l.after}` : '')
  + ('options' in l ? ` ${l.options.map((o) => o.text).join(' ')}` : '')
  + ('stem' in l ? ` ${l.lead}${l.stem}${l.ending}` : '')).join('\n');
/** The French is the answer on these; the English on the others. */
const answersFrench = (rung: Rung): boolean => taskOf(rung).to === 'fr';

test('a turned card shows the French, its IPA and the English, whatever it asked', () => {
  /* Every one of #5, #16, #27, #28 and #30 was a card that showed less than
     this in one state of one rung. */
  for (const rung of RUNGS) {
    const back = on(rung, true);
    assert.ok(text(back).includes('le bug') || text(back).includes('bug'), `${rung}: the French`);
    assert.ok(kinds(back).includes('ipa'), `${rung}: the IPA`);
    assert.ok(text(back).includes('bug'), `${rung}: the English`);
    if (!answersFrench(rung)) {
      assert.ok(kinds(back).includes('answer-en'), `${rung}: the English is the answer`);
      assert.ok(text(back).includes('insect · glitch'), `${rung}: and the other translations`);
    } else {
      assert.ok(kinds(back).includes('answer-fr'), `${rung}: the French is the answer`);
    }
  }
});

test('nothing that is the answer appears before the flip', () => {
  for (const rung of RUNGS) {
    const front = on(rung, false);
    const shown = text(front);
    if (answersFrench(rung)) {
      assert.equal(shown.includes('le bug'), false, `${rung}: the French is the answer`);
      assert.equal(kinds(front).some((k) => k === 'answer-fr' || k === 'ipa'), false, rung);
      /* The article is the gender, so the gender is the answer too. */
      assert.equal(front.some((l) => l.kind === 'hint' && /,\s*m$/.test(l.text)), false,
        `${rung}: the gender waits for the flip`);
      assert.equal(shown.includes(' · m'), false, `${rung}: the gender waits for the flip`);
    } else {
      assert.equal(kinds(front).includes('answer-en'), false, `${rung}: the English is the answer`);
      assert.equal(shown.includes('insect'), false, rung);
    }
  }
  /* And the gender does arrive with the flip. */
  assert.ok(on('write', true).some((l) => l.kind === 'hint' && l.text === 'noun, m'));
  assert.ok(on('use', true).some((l) => l.kind === 'alts' && l.text === 'bug · m'));
});

test('a card whose question is heard has the speaker on it, face down and face up', () => {
  for (const rung of RUNGS) {
    for (const revealed of [false, true]) {
      assert.equal(kinds(on(rung, revealed)).includes('speaker'), HEARD_FIRST.has(rung),
        `${rung} ${revealed ? 'turned' : 'face down'}`);
    }
  }
});

test('a typed card has the box before the flip and the verdict after, and no other card has either', () => {
  for (const rung of RUNGS) {
    const front = kinds(on(rung, false));
    const back = kinds(on(rung, true));
    assert.equal(front.includes('box'), TYPED.has(rung), `${rung}: the box`);
    assert.equal(back.includes('box'), false, `${rung}: no box once turned`);
    assert.equal(back.includes('verdict'), TYPED.has(rung), `${rung}: the verdict`);
    assert.equal(front.includes('verdict'), false, `${rung}: no verdict before`);
    assert.equal(back.includes('wrote'), TYPED.has(rung), `${rung}: what was typed, since it was wrong`);
  }
});

test('the sentence card blanks the word and fills it in on the flip', () => {
  const front = on('use', false).find((l) => l.kind === 'sentence');
  assert.deepEqual(front, { kind: 'sentence', before: 'Il y a un ', gap: '', after: ' dans le code.',
    filled: false });
  const back = on('use', true).find((l) => l.kind === 'sentence');
  assert.equal(back?.kind === 'sentence' && back.gap, 'bug');
  assert.ok(on('use', false).some((l) => l.kind === 'hint' && l.text === 'There is a bug in the code.'),
    'the English of the sentence is the hint');
  /* A "use it" card whose word has no sentence asks like a "write it" card. */
  assert.deepEqual(kinds(on('use', false, { ex: [] })), ['prompt-en', 'hint', 'box']);
});

test('what was typed is shown only where it was not right', () => {
  const right = face({ card: card('bug|noun', 'written', 'write'), word: full() },
    { revealed: true, typed: 'le bug', verdict: { verdict: 'ok' } });
  assert.equal(kinds(right).includes('wrote'), false);
  assert.ok(right.some((l) => l.kind === 'verdict' && l.ok && l.text === 'Correct'));
  const wrong = on('write', true);
  assert.ok(wrong.some((l) => l.kind === 'wrote' && l.text === 'le bogue'));
  assert.ok(wrong.some((l) => l.kind === 'verdict' && !l.ok && l.text === 'Not quite'));
});

test('a word with no IPA simply has no IPA line', () => {
  assert.equal(kinds(on('recognise', true, { ipa: '' })).includes('ipa'), false);
  assert.equal(kinds(on('recognise', true, { en: ['bug'] })).includes('alts'), false,
    'and one translation has no others');
});

test('the task strip agrees with the rung sets', () => {
  /* Two descriptions of the same rung — the sets the scheduler switches on,
     and the words and pictures the card opens with — would drift apart. */
  for (const rung of RUNGS) {
    const task = taskOf(rung);
    assert.equal(task.heard, HEARD_FIRST.has(rung), `${rung}: heard first`);
    assert.equal(task.to === 'fr', answersFrench(rung));
    assert.equal(task.from === 'fr', HEARD_FIRST.has(rung) || rung === 'recognise' || rung === 'use');
  }
});

/* ------------------------------------------- the sense and form channels -- */

const sur = (over: Partial<StudyItem['word']> = {}, reps = 0, rung: 'meet' | 'choose' | 'fill' = 'choose'): StudyItem => ({
  card: card('sur|prep', 'sense', rung, { reps }),
  word: word({ k: 'sur|prep', fr: 'sur', answer: 'sur', lemma: 'sur', pos: 'prep', en: ['on', 'onto'],
    ipa: '/syʁ/', kind: 'function', sense: 'on a surface', contrast: [key('sous|prep'), key('dans|prep')],
    ex: [ex('Le livre est sur la table.', 'sur', 'The book is on the table.'),
      ex('Un livre sur la guerre.', 'sur', 'A book about the war.')],
    ...over }),
});

test('a function word is met in a sentence long enough to be a scene', () => {
  const short = ex('Sur toi.', 'sur');
  const scene = ex('Je notai son numéro sur un morceau de papier.', 'sur');
  assert.equal(anchorFor({ ex: [short, scene] }), scene, 'six words or more, wherever it stands');
  assert.equal(anchorFor({ ex: [short] }), short, 'else whatever there is');
  assert.equal(anchorFor({ ex: [] }), null);
  assert.equal(anchorFor(null), null);
});

test('a choose card offers the word among its partners, in an order its rep count fixes', () => {
  const c = choiceFor(sur());
  assert.ok(c);
  assert.equal(c.answer, 'sur');
  assert.deepEqual([...c.options].sort((a, b) => a.localeCompare(b)), ['dans', 'sous', 'sur'],
    'partners by their spelling');
  assert.deepEqual(choiceFor(sur({}, 0))?.options, c.options, 'the same card, the same order');
  assert.notDeepEqual(choiceFor(sur({}, 1))?.options, c.options, 'the next time, another order');
  assert.equal(choiceFor(sur({ contrast: [] })), null, 'no partners, nothing to choose');
  assert.equal(choiceFor(sur({ ex: [] })), null, 'no sentence, nothing to fill');
});

test('a permutation is fixed by its seed and different across seeds', () => {
  assert.deepEqual(orderedBy(3, 7), orderedBy(3, 7));
  assert.deepEqual([...orderedBy(5, 3)].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  const seen = new Set([0, 1, 2, 3, 4, 5].map((s) => orderedBy(3, s).join('')));
  assert.ok(seen.size > 1);
});

const partir = {
  lemma: 'partir', aux: 'être', shape: '', compound: [], impersonal: [], links: [],
  groups: [
    { id: 'pres', mood: '', tense: 'Présent', stem: 'par', irregular: false, note: '',
      rows: [{ p: 'je', s: 'par', e: 's', f: 'pars' }, { p: 'tu', s: 'par', e: 's', f: 'pars' }] },
    { id: 'fut', mood: '', tense: 'Futur', stem: 'partir', irregular: false, note: '',
      rows: [{ p: 'je', s: 'partir', e: 'ai', f: 'partirai' }] },
    { id: 'hist', mood: '', tense: 'Passé simple', stem: '', irregular: false, note: '',
      rows: [{ p: 'je', s: 'part', e: 'is', f: 'partis' }] },
  ],
  examples: {
    pc: [ex('Il est parti.', 'est parti', 'He left.'), ex('Hier il est parti.', 'est parti')],
    imp: [ex('Il partait.', 'partait', 'He was leaving.')],
  },
};
const verb = (rung: 'tense' | 'voice', reps = 0): StudyItem => ({
  card: card('partir|verb', 'form', rung, { reps }),
  word: word({ k: 'partir|verb', fr: 'partir', lemma: 'partir', pos: 'verb', en: ['to leave'],
    ipa: '/paʁ.tiʁ/', conj: partir }),
});

test('a which-time card rotates the tense with the rep count and never deals a timed sentence', () => {
  const first = tenseFor(verb('tense', 0));
  assert.equal(first?.tense, 'pc');
  assert.equal(first?.example.fr, 'Il est parti.', '"Hier il est parti" says when without the ending');
  assert.equal(tenseFor(verb('tense', 1))?.tense, 'imp');
  assert.equal(tenseFor(verb('tense', 2))?.tense, 'pc', 'round again');
  assert.deepEqual(first?.options.map((o) => o.tense), ['pc', 'imp', 'fut'],
    'three times to choose from, whatever the verb has: two is a coin toss');
  assert.equal(first?.name, 'Passé composé');
  const one = { ...verb('tense'), word: word({ conj: { ...partir, examples: { pc: partir.examples.pc } } }) };
  assert.equal(tenseFor(one), null, 'one tense is nothing to choose');
});

test('a voice card walks the core tenses and their rows, and skips the literary ones', () => {
  const a = lineFor(verb('voice', 0));
  assert.equal(a?.text, 'je pars');
  assert.equal(a?.name, 'Présent');
  assert.equal(a?.slot, 'conj:pres:0');
  assert.equal(lineFor(verb('voice', 1))?.text, 'je partirai', 'the next tense');
  assert.equal(lineFor(verb('voice', 2))?.text, 'tu pars', 'round again, the next row');
  for (let reps = 0; reps < 12; reps += 1) {
    assert.notEqual(lineFor(verb('voice', reps))?.group.id, 'hist', 'never the passé simple');
  }
  assert.equal(lineFor({ ...verb('voice'), word: word({}) }), null, 'a noun has no lines');
});

/** The five new rungs, each on a word that can be asked on it. */
const NEW: { rung: Rung; make: () => StudyItem; answer: string }[] = [
  { rung: 'meet', make: () => sur({}, 0, 'meet'), answer: 'on' },
  { rung: 'choose', make: () => sur({}, 0, 'choose'), answer: 'sur' },
  { rung: 'fill', make: () => sur({}, 0, 'fill'), answer: 'sur' },
  { rung: 'tense', make: () => verb('tense'), answer: 'Passé composé' },
  { rung: 'voice', make: () => verb('voice'), answer: 'pars' },
];

test('on the new rungs too, the answer waits for the flip and arrives with it', () => {
  for (const { rung, make, answer } of NEW) {
    const front = face(make(), { revealed: false });
    const back = text(face(make(), { revealed: true }));
    /* On a choose card the answer is on the front by design — among the
       options, which is the whole question — so what must not be filled in
       there is the gap. */
    if (rung === 'choose') {
      assert.ok(front.some((l) => l.kind === 'sentence' && !l.filled && l.gap === ''), 'choose: the gap is empty');
    } else if (rung !== 'meet') {
      assert.equal(text(front).includes(answer), false, `${rung}: not before`);
    }
    assert.ok(back.includes(answer), `${rung}: after`);
  }
  /* The meeting is the one card that is not a question: the sense line and
     the sentence are on the front, the glosses on the back. */
  assert.ok(text(face(sur({}, 0, 'meet'), { revealed: false })).includes('on a surface'));
  assert.equal(text(face(sur({}, 0, 'meet'), { revealed: false })).includes('onto'), false);
});

test('a tap card has its options face down and its verdict face up, and a wrong tap is struck', () => {
  for (const { rung, make } of NEW.filter((n) => CHOSEN.has(n.rung))) {
    const front = face(make(), { revealed: false });
    const options = front.find((l) => l.kind === 'options');
    assert.ok(options && options.kind === 'options' && options.options.length === 3, `${rung}: three options`);
    assert.equal(kinds(front).includes('box'), false, `${rung}: nothing to type`);
    assert.equal(kinds(front).includes('verdict'), false, `${rung}: no verdict before a tap`);
    const back = face(make(), { revealed: true, picked: ['sous', 'sur'], verdict: { verdict: 'no' } });
    assert.ok(kinds(back).includes('verdict'), `${rung}: the verdict`);
    assert.equal(kinds(back).includes('options'), false, `${rung}: the options are gone`);
  }
  const struck = face(sur(), { revealed: false, picked: ['sous'] }).find((l) => l.kind === 'options');
  assert.ok(struck && struck.kind === 'options');
  assert.deepEqual(struck.options.filter((o) => o.wrong).map((o) => o.value), ['sous']);
  assert.ok(face(sur(), { revealed: false, picked: ['sous'] }).some((l) => l.kind === 'verdict' && !l.ok),
    'and the card says to try again');
  const back = face(sur(), { revealed: true, picked: ['sous', 'sur'], verdict: { verdict: 'no' } });
  assert.ok(back.some((l) => l.kind === 'tapped' && l.text === 'sous'), 'what was tapped first');
});

test('the fill card is graded on the letter, and shows the sense on the flip', () => {
  const front = face(sur({}, 0, 'fill'), { revealed: false });
  assert.ok(front.some((l) => l.kind === 'sentence' && l.before === 'Le livre est ' && !l.filled));
  assert.ok(kinds(front).includes('box'));
  assert.equal(kinds(front).includes('alts'), false, 'no English gloss beside the gap: the sentence says it');
  const back = face(sur({}, 0, 'fill'), { revealed: true, typed: 'sous', verdict: { verdict: 'no' } });
  assert.ok(back.some((l) => l.kind === 'sense' && l.text === 'on a surface'));
  assert.ok(back.some((l) => l.kind === 'wrote' && l.text === 'sous'));
});

test('the voice card names the pronoun and the tense, and marks the ending on the flip', () => {
  const front = face(verb('voice'), { revealed: false });
  assert.ok(front.some((l) => l.kind === 'prompt-en' && l.text === 'je · partir'));
  assert.ok(front.some((l) => l.kind === 'hint' && l.text === 'Présent · to leave'));
  assert.ok(front.some((l) => l.kind === 'status'));
  const back = face(verb('voice'), { revealed: true });
  assert.deepEqual(back.find((l) => l.kind === 'form'),
    { kind: 'form', lead: 'je ', stem: 'par', ending: 's', also: '' });
});

test('the task strip of every new rung agrees with the rung sets', () => {
  for (const rung of [...SENSE_RUNGS, ...FORM_RUNGS]) {
    const task = taskOf(rung);
    assert.equal(task.heard, false, `${rung}: nothing here is heard first`);
    assert.equal(task.to === 'fr', rung === 'choose' || rung === 'fill' || rung === 'voice');
  }
});
