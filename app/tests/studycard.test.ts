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
import { HEARD_FIRST, HEARD_RUNGS, WRITTEN_RUNGS } from '../src/lib/keys.js';
import type { Rung } from '../src/lib/keys.js';
import type { KeyContext } from '../src/lib/shortcuts.js';
import type { CardAudio } from '../src/lib/audio.js';
import type { StudyItem } from '../src/lib/queue.js';
import { card, word } from './make.js';

const RUNGS: Rung[] = [...WRITTEN_RUNGS, ...HEARD_RUNGS];

const item = (rung: Rung): StudyItem => ({
  card: card('bug|noun', HEARD_FIRST.has(rung) ? 'heard' : 'written', rung),
  word: word({
    fr: 'le bug', answer: 'le bug', gender: 'm', ipa: '/bœɡ/', en: ['bug', 'insect', 'glitch'],
    ex: [{ fr: 'Il y a un bug dans le code.', f: 'bug', en: 'There is a bug in the code.' }],
    def: { fr: ['Défaut dans un programme.'] },
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
    onTyped: () => {}, onCheck: () => {}, onVoiceDone: () => {},
  } }).body;
}

test('every line the face has is on the drawn card, on every rung, both ways up', () => {
  for (const rung of RUNGS) {
    for (const revealed of [false, true]) {
      const html = draw(rung, revealed);
      const page = textOf(html);
      const where = `${rung}, ${revealed ? 'turned' : 'face down'}`;
      for (const line of face(item(rung), { revealed, typed: 'le bogue', verdict: { verdict: 'no' } })) {
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
          default:
            if (line.text) assert.ok(page.includes(line.text), `${where}: "${line.text}"`);
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
