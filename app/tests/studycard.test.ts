/** The card, drawn: what face() says is on it is on it.
 *
 *  face() is tested as data over every rung in both states. This renders the
 *  component the way SvelteKit prerenders it and checks that every line the
 *  data has reaches the page — so a template branch that drops one fails
 *  here, not in front of the learner. #30 was a line drawn inside the wrong
 *  branch, and would have failed this.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { render } from 'svelte/server';
import StudyCard from '../src/lib/components/StudyCard.svelte';
import { face } from '../src/lib/cardface.js';
import { ALL_RUNGS, HEARD_FIRST, channelOf } from '../src/lib/keys.js';
import type { Rung } from '../src/lib/keys.js';
import type { KeyContext } from '../src/lib/shortcuts.js';
import type { CardAudio } from '../src/lib/audio.js';
import type { StudyItem } from '../src/lib/queue.js';
import { card, k, ruleCard, word } from './make.js';

const RUNGS: readonly Rung[] = ALL_RUNGS;

/* A word that can be asked on every rung: a noun with a sentence, and the
   sense, the partners and the verb table the new rungs read. The
   invariants are about the drawing, so one word with everything on it is
   what the rungs are walked with. */
const item = (rung: Rung): StudyItem => ({
  kind: 'word',
  card: card('bug|noun', channelOf(rung), rung),
  word: word({
    fr: 'le bug', answer: 'le bug', gender: 'm', ipa: '/bœɡ/', en: ['bug', 'insect', 'glitch'],
    ex: [{ fr: 'Il y a un bug dans le code.', f: 'bug', en: 'There is a bug in the code.' }],
    def: { fr: ['Défaut dans un programme.'] },
    sense: 'a fault in a program', contrast: [k('cafard|noun')],
    chunks: [{ fr: 'buguer sur qch', en: 'to crash on something' }],
    conj: {
      lemma: 'buguer', aux: 'avoir', shape: '', compound: [], impersonal: [], links: [],
      groups: [{ id: 'pres', mood: '', tense: 'Présent', stem: 'bugu', irregular: false, note: '',
        rows: [{ p: 'je', s: 'bugu', e: 'e', f: 'bugue' }] }],
      examples: {
        pc: [{ fr: 'Le code a bugué.', f: 'a bugué', en: 'The code crashed.' }],
        imp: [{ fr: 'Le code buguait.', f: 'buguait', en: 'The code kept crashing.' }],
      },
    },
  }),
});

const silent: CardAudio = {
  has: { fr: true, native: false, en: true }, canSay: true, spoken: false, canCue: true, making: false,
  trouble: '', play: () => {}, playModel: () => {}, cue: () => {},
};
const keys = (rung: Rung, revealed: boolean): KeyContext => ({
  idle: false, browsing: false, revealed, rung, canOlder: false,
  has: { fr: true, native: false }, canSay: true, spoken: false, canCue: true,
});

/** The page's text, tags stripped and entities read back. */
const textOf = (html: string): string => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

function draw(rung: Rung, revealed: boolean): string {
  return render(StudyCard, { props: {
    item: item(rung), revealed, typed: 'le bogue', verdict: { verdict: 'no' },
    audio: silent, keys: keys(rung, revealed), showDefs: true, showForms: false, input: null,
    picked: ['cafard'], onTyped: () => {}, onCheck: () => {},
  } }).body;
}

test('every line the face has is on the drawn card, on every rung, both ways up', () => {
  for (const rung of RUNGS) {
    for (const revealed of [false, true]) {
      const html = draw(rung, revealed);
      const page = textOf(html);
      const where = `${rung}, ${revealed ? 'turned' : 'face down'}`;
      for (const line of face(item(rung), { revealed, typed: 'le bogue', verdict: { verdict: 'no' },
        picked: ['cafard'] })) {
        switch (line.kind) {
          case 'speaker':
            assert.ok(/class="speaker[ "]/.test(html), `${where}: the speaker`); break;
          case 'box':
            assert.ok(html.includes(`placeholder="${line.placeholder}"`), `${where}: the box`); break;
          case 'sentence':
            assert.ok(page.includes(line.before.trim()) && page.includes(line.after.trim()),
              `${where}: the sentence`);
            if (line.filled) assert.ok(page.includes(line.gap), `${where}: the gap filled`);
            break;
          case 'marked':
            /* The tag carries the component's scoped class. */
            assert.ok(page.includes(line.mark) && new RegExp(`<mark[^>]*>${line.mark}</mark>`).test(html),
              `${where}: the form marked in its sentence`);
            break;
          case 'options':
            for (const o of line.options) {
              assert.ok(page.includes(o.text), `${where}: the option "${o.text}"`);
            }
            /* "option " and not "option": the row of them is class="options". */
            assert.equal((html.match(/class="option [^"]*"/g) ?? []).length, line.options.length,
              `${where}: one button per option`);
            if (line.options.some((o) => o.wrong)) {
              assert.ok(/class="option[^"]* wrong[^"]*"[^>]*disabled/.test(html),
                `${where}: the wrong tap is struck and cannot be tapped again`);
            }
            break;
          case 'form':
            /* Tags read as spaces in `page`, so the stem and the ending are
               looked for apart; the ending's own span is looked for whole. */
            assert.ok(page.includes(`${line.lead}${line.stem}`.trim()), `${where}: the pronoun and stem`);
            assert.ok(new RegExp(`<span class="ending[^"]*">${line.ending}</span>`).test(html),
              `${where}: the ending marked`);
            break;
          case 'chunks':
            for (const c of line.items) {
              assert.ok(page.includes(c.fr) && page.includes(c.en), `${where}: the chunk "${c.fr}"`);
            }
            break;
          default:
            if ('text' in line && line.text) assert.ok(page.includes(line.text), `${where}: "${line.text}"`);
        }
      }
    }
  }
});

test('the task strip says what the card asks, in the language it asks it', () => {
  assert.ok(textOf(draw('hear', false)).includes('Listen, recall the English'));
  assert.ok(draw('hear', false).includes('aria-label="Listen, recall the English: French to English"'));
  assert.ok(draw('write', true).includes('aria-label="Type the French, then say it: English to French"'));
});

test('a word of your own offers Make audio only where what it makes can be played', () => {
  /* #51: the English-facing front of a write card showed the button, and
     what it made could not be played from there. */
  const mine = (rung: Rung, revealed: boolean): string => render(StudyCard, { props: {
    item: { kind: 'word', card: card('natel|noun', channelOf(rung), rung),
      word: word({ k: 'natel|noun', fr: 'le natel', answer: 'le natel', en: ['mobile phone'],
        audio: null, native: null, user: true }) },
    revealed, typed: '', verdict: null, audio: silent, keys: keys(rung, revealed),
    showDefs: true, showForms: false, input: null, picked: [],
    onTyped: () => {}, onCheck: () => {},
  } }).body;
  assert.equal(mine('write', false).includes('card-voice'), false, 'the English is showing');
  assert.ok(mine('write', true).includes('card-voice'), 'the back can play the French');
  assert.ok(mine('hear', false).includes('card-voice'), 'a card asked by ear plays the French first');
  assert.equal(mine('recognise', false).includes('card-voice'), false,
    'the French is shown, but nothing on this face plays it');
});

test('while a clip is being made the card says so, on the text and on the button', () => {
  /* The chip used to change its label to "Making it…" and nothing else on
     the card moved; the sweep over the French and the spinner in place of
     the speaker are the same signs every other screen uses. */
  const drawn = (rung: Rung, revealed: boolean, making: boolean): string => render(StudyCard, {
    props: {
      item: item(rung), revealed, typed: '', verdict: null, audio: { ...silent, making },
      keys: keys(rung, revealed), showDefs: true, showForms: false, input: null, picked: [],
      onTyped: () => {}, onCheck: () => {},
    } }).body;
  const turned = drawn('recognise', true, true);
  assert.match(turned, /class="prompt[^"]*\bmaking\b/, 'the French wears the sweep');
  assert.match(turned, /class="[^"]*\bspin\b/, 'and the chip a spinner');
  assert.equal(textOf(turned).includes('Making it'), false, 'no label swap beside it');
  const still = drawn('recognise', true, false);
  assert.doesNotMatch(still, /\bmaking\b/);
  assert.doesNotMatch(still, /\bspin\b/);
  const heard = drawn('hear', false, true);
  /* The server renderer leaves a hydration marker between the button and its icon. */
  assert.match(heard, /class="speaker[^>]*>(?:\s|<!--[^>]*-->)*<svg[^>]*\bspin\b/, 'the big speaker turns too');
  const speaker = heard.match(/class="speaker[\s\S]*?<\/button>/)?.[0] ?? '';
  assert.doesNotMatch(speaker, /volume-2/, 'and is not also a speaker');
});

test('the definitions and the sound buttons are on the back and not the front', () => {
  assert.ok(textOf(draw('recognise', true)).includes('Défaut dans un programme.'));
  assert.equal(textOf(draw('recognise', false)).includes('Défaut'), false);
  assert.ok(textOf(draw('recognise', true)).includes('Hear again'));
  assert.equal(textOf(draw('recognise', false)).includes('Hear again'), false);
});

test('one action, one button: the French is played from one button on every face', () => {
  /* The back of a "use it" card said "Hear the sentence" in its row of sounds
     and "hear the sentence again" in the aid under it, with `s` beside both
     (#63); the back of a listening card had "Play it again" over the answer
     and "Hear again" below it, the same way. `s` is the key of exactly one
     shortcut, so counting the `s` drawn on a face counts its buttons for it. */
  const sKeys = (html: string): number => (html.match(/<kbd[^>]*>s<\/kbd>/g) ?? []).length;
  for (const rung of RUNGS) {
    assert.equal(sKeys(draw(rung, true)), 1, `${rung}, turned: one button plays the French`);
    assert.equal(sKeys(draw(rung, false)), HEARD_FIRST.has(rung) ? 1 : 0,
      `${rung}, face down: the speaker on a card asked by ear, nothing otherwise`);
  }
  const use = textOf(draw('use', true));
  assert.equal((use.match(/hear the sentence/gi) ?? []).length, 1,
    'a use card says "Hear the sentence" once');
  const hear = draw('hear', true);
  assert.ok(/class="speaker[ "]/.test(hear), 'a listening card keeps its speaker');
  assert.equal(textOf(hear).includes('Hear again'), false, 'and gets no second button under it');
});

test('a word without a recording still offers to play it again when the device can say it', () => {
  /* #81: the back hid "play it again" and its `s` for a word with no
     recording, while the speaker on the front of the card asked the device
     and was heard. The chip follows whether the French can be heard, not
     whether it is a file. */
  const drawn = (audio: CardAudio, ctx: KeyContext): string => render(StudyCard, { props: {
    item: item('recognise'), revealed: true, typed: '', verdict: null, audio, keys: ctx,
    showDefs: true, showForms: false, input: null, picked: [],
    onTyped: () => {}, onCheck: () => {},
  } }).body;
  const said = drawn({ ...silent, has: { fr: false, native: false, en: false }, canSay: true, canCue: false },
    { ...keys('recognise', true), has: { fr: false, native: false }, canSay: true, canCue: false });
  assert.ok(textOf(said).includes('Hear again'), 'the device will say it');
  const mute = drawn({ ...silent, has: { fr: false, native: false, en: false }, canSay: false, canCue: false },
    { ...keys('recognise', true), has: { fr: false, native: false }, canSay: false, canCue: false });
  assert.equal(textOf(mute).includes('Hear again'), false, 'nothing here can say it');
});

test('a grammar exercise is drawn as its cells: a box per row before the check, each verdict after', () => {
  const drill: StudyItem = { kind: 'rule', card: ruleCard('V.pres-er'), instance: {
    id: 'table:parler|verb:pres', gen: 'table', face: 'gap', spec: {}, genv: 1, rule: 'V.pres-er',
    title: 'parler · Présent', hint: 'to speak',
    cells: [{ prompt: 'je', expected: 'parle', obs: [] }, { prompt: 'nous', expected: 'parlons', obs: [] }],
  } };
  const props = { audio: silent, keys: keys('write', false), showDefs: true, showForms: false, input: null,
    typed: '', verdict: null, picked: [], onTyped: () => {}, onCheck: () => {} };
  const down = render(StudyCard, { props: { ...props, item: drill, revealed: false, cells: ['parl', ''] } }).body;
  assert.ok(textOf(down).includes('parler · Présent') && textOf(down).includes('to speak'));
  assert.equal((down.match(/<input /g) ?? []).length, 2, 'a box per cell');
  assert.ok(down.includes('value="parl"'), 'what is in a cell is in its box');
  assert.ok(textOf(down).includes('Fill in the forms'), 'the task strip says what to do');
  assert.ok(!down.includes('Verb forms'), 'no word: no drawers of a word');

  const parts = [{ expected: 'parle', got: 'parle', ok: true, obs: [] },
    { expected: 'parlons', got: 'parlent', ok: false, obs: [] }];
  const up = render(StudyCard, { props: { ...props, item: drill, revealed: true, parts,
    verdict: { verdict: 'no' } } }).body;
  assert.equal((up.match(/<input /g) ?? []).length, 0, 'checked: no boxes');
  assert.ok(textOf(up).includes('1 of 2 right'));
  assert.ok(/<s[^>]*>parlent<\/s>/.test(up), 'the wrong cell struck through');
  assert.ok(/class="cell[^"]* wrong/.test(up) && /class="cell[^"]* ok/.test(up));
  assert.ok(!textOf(up).includes('Hear it'), 'a table has nothing to say, so nothing to hear');
});

test('a checked number offers to be heard, where the device can say it; one heard has its speaker instead', async () => {
  /* A number written in silence was the one exercise that was never said
     aloud (#95): the flip says it, and the turned card can say it again. */
  const { numberFor, numberHearFor } = await import('../src/lib/grammar/numbers.js');
  const spoken: CardAudio = { ...silent, spoken: true };
  const props = { audio: spoken, keys: { ...keys('write', true), rung: null, drill: true }, showDefs: true,
    showForms: false, input: null, typed: '', verdict: null, picked: [], onTyped: () => {}, onCheck: () => {} };
  const written: StudyItem = { kind: 'rule', card: ruleCard('N.units'), instance: numberFor(7, 'N.units') };
  const parts = [{ expected: 'sept', got: 'sept', ok: true, obs: [] }];
  const up = render(StudyCard, { props: { ...props, item: written, revealed: true, parts } }).body;
  assert.ok(textOf(up).includes('Hear it'), 'the turned card offers the answer aloud');
  const down = render(StudyCard, { props: { ...props, item: written, revealed: false } }).body;
  assert.ok(!textOf(down).includes('Hear it'), 'not before the check: the answer is the answer');
  const heard: StudyItem = { kind: 'rule', card: ruleCard('N.units'), instance: numberHearFor(7, 'N.units') };
  const back = render(StudyCard, { props: { ...props, item: heard, revealed: true, parts: [{ expected: '7', got: '7', ok: true, obs: [] }] } }).body;
  assert.ok(!textOf(back).includes('Hear it') && /class="speaker[ "]/.test(back), 'its speaker is on the face already');
});

test('a sentence to rewrite is drawn with its verb marked, one box, and the task says so', () => {
  const drill: StudyItem = { kind: 'rule', card: ruleCard('G.pas'), instance: {
    id: 'sentence:parler|verb:1:G.pas', gen: 'negation', face: 'transform', spec: {}, genv: 1, rule: 'G.pas',
    title: 'Make it negative', hint: 'We speak French.',
    cells: [{ prompt: '', expected: 'Nous ne parlons pas français.', obs: [] }],
    sentence: { fr: 'Nous parlons français.', f: 'parlons', en: 'We speak French.', id: 1 },
  } };
  const html = render(StudyCard, { props: { item: drill, revealed: false, cells: [], typed: '', verdict: null,
    picked: [], audio: silent, keys: keys('write', false), showDefs: true, showForms: false, input: null,
    onTyped: () => {}, onCheck: () => {} } }).body;
  assert.ok(/<mark[^>]*>parlons<\/mark>/.test(html), 'the verb marked in its sentence');
  assert.ok(textOf(html).includes('Rewrite the sentence'));
  assert.equal((html.match(/<input /g) ?? []).length, 1);
});

test('a cell answered by tapping draws its choices as buttons, the tapped one held', () => {
  const drill: StudyItem = { kind: 'rule', card: ruleCard('D.gender'), instance: {
    id: 'det:jour|noun:D.gender', gen: 'determiner', face: 'choose', spec: {}, genv: 1, rule: 'D.gender',
    title: 'jour', hint: 'day', cells: [{ prompt: '', expected: 'le', options: ['le', 'la'], obs: [] }],
  } };
  const props = { audio: silent, keys: keys('write', false), showDefs: true, showForms: false, input: null,
    typed: '', verdict: null, picked: [], onTyped: () => {}, onCheck: () => {} };
  const html = render(StudyCard, { props: { ...props, item: drill, revealed: false, cells: ['la'] } }).body;
  assert.equal((html.match(/<input /g) ?? []).length, 0, 'no box: it is tapped');
  assert.equal((html.match(/class="option small[^"]*"/g) ?? []).length, 2, 'a button per choice');
  assert.ok(/class="option small[^"]* chosen"[^>]*aria-pressed="true"[^>]*>la</.test(html), 'the tapped one held');
  assert.ok(textOf(html).includes('Tap the right one'));
});

test('an order cell draws what is built and the pieces still to tap; a mark cell holds every piece tapped', () => {
  const props = { audio: silent, keys: keys('write', false), showDefs: true, showForms: false, input: null,
    typed: '', verdict: null, picked: [], onTyped: () => {}, onCheck: () => {} };
  const order: StudyItem = { kind: 'rule', card: ruleCard('G.pas-infinitive'), instance: {
    id: 'order:x', gen: 'order', face: 'order', spec: {}, genv: 1, rule: 'G.pas-infinitive', title: 'x', hint: '',
    cells: [{ prompt: '', expected: 'je ne veux pas parler', pieces: ['pas', 'je', 'parler', 'ne', 'veux'], obs: [] }],
  } };
  const html = render(StudyCard, { props: { ...props, item: order, revealed: false, cells: ['je ne'] } }).body;
  assert.ok(/class="built[^"]*"[^>]*>je ne</.test(html), 'what is built so far');
  assert.equal((html.match(/class="option small[^"]*"/g) ?? []).length, 3, 'the three pieces left');
  assert.ok(html.includes('aria-label="start again"'));
  const mark: StudyItem = { kind: 'rule', card: ruleCard('P.verb-endings'), instance: {
    id: 'mark:x', gen: 'soundalike', face: 'mark', spec: {}, genv: 1, rule: 'P.verb-endings', title: 'x', hint: '',
    cells: [{ prompt: '', expected: 'a · c', pieces: ['a', 'b', 'c'], multi: true, obs: [] }],
  } };
  const marked = render(StudyCard, { props: { ...props, item: mark, revealed: false, cells: ['a · c'] } }).body;
  assert.equal((marked.match(/aria-pressed="true"/g) ?? []).length, 2, 'two held');
  assert.equal((marked.match(/aria-pressed="false"/g) ?? []).length, 1);
  assert.ok(textOf(marked).includes('Tap all that apply'));
});
