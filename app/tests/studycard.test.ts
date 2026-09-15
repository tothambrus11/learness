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
import { ALL_RUNGS, channelOf } from '../src/lib/keys.js';
import type { Rung } from '../src/lib/keys.js';
import type { KeyContext } from '../src/lib/shortcuts.js';
import type { CardAudio } from '../src/lib/audio.js';
import type { StudyItem } from '../src/lib/queue.js';
import { card, k, word } from './make.js';

const RUNGS: readonly Rung[] = ALL_RUNGS;

/* A word that can be asked on every rung: a noun with a sentence, and the
   sense, the partners and the verb table the new rungs read. The
   invariants are about the drawing, so one word with everything on it is
   what the rungs are walked with. */
const item = (rung: Rung): StudyItem => ({
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
  has: { fr: true, native: false, en: true }, spoken: false, canCue: true, making: false,
  trouble: '', play: () => {}, playModel: () => {}, cue: () => {},
};
const keys = (rung: Rung, revealed: boolean): KeyContext => ({
  idle: false, browsing: false, revealed, rung, canOlder: false,
  has: { fr: true, native: false }, spoken: false, canCue: true,
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
    picked: ['cafard'], onTyped: () => {}, onCheck: () => {}, onVoiceDone: () => {},
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

test('the definitions and the sound buttons are on the back and not the front', () => {
  assert.ok(textOf(draw('recognise', true)).includes('Défaut dans un programme.'));
  assert.equal(textOf(draw('recognise', false)).includes('Défaut'), false);
  assert.ok(textOf(draw('recognise', true)).includes('Hear again'));
  assert.equal(textOf(draw('recognise', false)).includes('Hear again'), false);
});
