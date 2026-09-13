/** What a card puts on screen, decided away from the screen.
 *
 *  These four used to live inside the study page's template, where nothing
 *  could reach them: the sentence a card blanks, where the blank falls, which
 *  English to read out, and which senses are worth printing under an answer
 *  that already says one of them.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { blank, cueOf, senses, sentenceAt, sentenceFor } from '../src/lib/cardface.js';
import { card, word } from './make.js';
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
import { HEARD_FIRST, HEARD_RUNGS, TYPED, WRITTEN_RUNGS } from '../src/lib/keys.js';
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
  + ('before' in l ? ` ${l.before}${l.gap}${l.after}` : '')).join('\n');
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
