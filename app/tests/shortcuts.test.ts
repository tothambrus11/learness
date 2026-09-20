/** The sitting's keyboard: one table, read two ways.
 *
 *  The speaker on a dictation card once said `s` while the cursor was in the
 *  answer box, where `s` is a letter (#28), and a learner who wanted the
 *  letters back while typing had nothing to press (#35). Both were the hint
 *  and the handler being written apart. Here they are the same row, and the
 *  last test presses every hint to prove it.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { available, fieldOpen, hint, resolve } from '../src/lib/shortcuts.js';
import type { KeyContext, KeyPress, ShortcutId } from '../src/lib/shortcuts.js';
import type { Rung } from '../src/lib/keys.js';
import { HEARD_RUNGS, WRITTEN_RUNGS } from '../src/lib/keys.js';

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  idle: false, browsing: false, revealed: false, rung: 'write', canOlder: true,
  has: { fr: true, native: true }, canSay: true, spoken: false, canCue: true, ...over,
});

/** A keypress of one key, as a keyboard sends it. */
const press = (key: string, over: Partial<KeyPress> = {}): KeyPress => ({
  key,
  code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key,
  alt: false, ctrl: false, meta: false, shift: false, inField: false, ...over,
});

test('inside the answer box a letter is a letter, and alt makes it a shortcut', () => {
  const dictation = ctx({ rung: 'dictate' });
  assert.equal(fieldOpen(dictation), true);
  assert.equal(resolve(press('s', { inField: true }), dictation), null,
    'the s is part of what is being typed');
  assert.equal(resolve(press('s', { inField: true, alt: true }), dictation), 'playModel');
  assert.equal(resolve(press('Enter', { inField: true }), dictation), 'check',
    'enter is the box’s own key and needs nothing held');
  assert.equal(resolve(press('Enter', { inField: true, shift: true }), dictation), 'replay');
});

test('the hint shows the keys that work: alt while the box is open, bare after the flip', () => {
  const typing = ctx({ rung: 'dictate' });
  assert.deepEqual(hint('playModel', typing), ['alt', 's']);
  assert.deepEqual(hint('check', typing), ['enter'], 'the box’s own key gets no alt');
  assert.deepEqual(hint('replay', typing), ['shift', 'enter']);
  const flipped = ctx({ rung: 'dictate', revealed: true });
  assert.deepEqual(hint('playModel', flipped), ['s']);
  assert.deepEqual(hint('good', flipped), ['3']);
  assert.deepEqual(hint('older', flipped), ['←']);
  assert.deepEqual(hint('show', ctx({ rung: 'recognise' })), ['space']);
});

test('before the flip, the answer is never played', () => {
  /* On a "write it" card the French is the answer; on a "listen, recall the
     English" card the English is. Neither key does anything, and neither
     button draws a hint, until the card is turned. */
  const writing = ctx({ rung: 'write' });
  assert.equal(resolve(press('s', { inField: true, alt: true }), writing), null);
  assert.equal(resolve(press('n'), writing), null);
  assert.equal(resolve(press('e', { inField: true, alt: true }), writing), 'cue',
    'the English is the question, so it may be heard');
  assert.deepEqual(hint('playModel', writing), []);
  assert.deepEqual(hint('cue', writing), ['alt', 'e']);

  const listening = ctx({ rung: 'hear' });
  assert.equal(resolve(press('e'), listening), null, 'the English is the answer');
  assert.equal(resolve(press('s'), listening), 'playModel', 'the French is the question');
  assert.equal(available('cue', listening), false);
  assert.equal(available('cue', ctx({ rung: 'hear', revealed: true })), true);
});

test('on a Mac alt+s arrives as ß, and the physical key is what counts', () => {
  const dictation = ctx({ rung: 'dictate' });
  assert.equal(resolve({ ...press('ß'), code: 'KeyS', alt: true, inField: true }, dictation),
    'playModel');
});

test('ctrl and meta belong to the browser', () => {
  const flipped = ctx({ revealed: true });
  assert.equal(resolve(press('s', { ctrl: true }), flipped), null);
  assert.equal(resolve(press('s', { meta: true }), flipped), null);
  assert.equal(resolve(press('1', { meta: true }), flipped), null);
});

test('grading needs a turned card, and looking back turns grading off', () => {
  assert.equal(resolve(press('3'), ctx({ revealed: false, rung: 'recognise' })), null);
  assert.equal(resolve(press('3'), ctx({ revealed: true })), 'good');
  const back = ctx({ browsing: true, revealed: true });
  assert.equal(resolve(press('3'), back), null, 'the grade already given stands');
  assert.equal(resolve(press('p'), back), null);
  assert.equal(resolve(press('d'), back), 'toggleDefs', 'the definitions are a view, not an answer');
  assert.equal(resolve(press(' '), back), 'continue');
  assert.equal(resolve(press('ArrowRight'), back), 'newer');
  assert.deepEqual(hint('newer', back), ['→'], 'and the bar draws the arrow beside "Next card"');
  assert.equal(resolve(press('s'), back), 'playModel', 'the sounds still play');
});

test('space and enter flip a card that is not typed, and only that', () => {
  assert.equal(resolve(press(' '), ctx({ rung: 'recognise' })), 'show');
  assert.equal(resolve(press('Enter'), ctx({ rung: 'say' })), 'show');
  assert.equal(resolve(press(' '), ctx({ rung: 'write' })), null,
    'a typed card is answered from its box, not flipped');
  assert.equal(resolve(press(' '), ctx({ rung: 'recognise', revealed: true })), null);
  assert.equal(resolve(press('ArrowRight'), ctx({ rung: 'recognise' })), null,
    'nothing newer than the live card');
  assert.deepEqual(hint('newer', ctx({ rung: 'recognise' })), [], 'so "Next card" sits greyed with no key');
  assert.equal(resolve(press('ArrowLeft'), ctx({ canOlder: false })), null);
});

test('nothing fires while there is no card', () => {
  for (const key of ['s', 'n', 'e', '1', ' ', 'Enter', 'ArrowLeft', 'p', 'd']) {
    assert.equal(resolve(press(key), ctx({ idle: true, revealed: true })), null, key);
  }
});

test('every hint, pressed, lands on the shortcut it was read from', () => {
  /* The whole point of the table: the hint beside a button and the key that
     reaches it are one row, so pressing what the button shows must do what
     the button does, in every state the card can be in. */
  const ids: ShortcutId[] = ['older', 'newer', 'continue', 'show', 'check', 'replay',
    'playModel', 'playNative', 'cue', 'again', 'hard', 'good', 'easy', 'flagSaid', 'toggleDefs',
    'edit'];
  const rungs: Rung[] = [...WRITTEN_RUNGS, ...HEARD_RUNGS];
  const unlabel: Record<string, string> = { space: ' ', enter: 'Enter', '←': 'ArrowLeft',
    '→': 'ArrowRight' };
  let checked = 0;
  for (const rung of rungs) {
    for (const revealed of [false, true]) {
      for (const browsing of [false, true]) {
        const c = ctx({ rung, revealed, browsing });
        const inField = fieldOpen(c);
        for (const id of ids) {
          const keys = hint(id, c);
          assert.equal(keys.length > 0, available(id, c), `${id} on ${rung}: hint and availability agree`);
          if (!keys.length) continue;
          const alt = keys.includes('alt');
          const shift = keys.includes('shift');
          const last = keys.at(-1)!;
          const key = unlabel[last] ?? last;
          assert.equal(resolve(press(key, { alt, shift, inField }), c), id,
            `${keys.join('+')} on a ${revealed ? 'turned' : 'face-down'} ${rung} card`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 60, `only ${checked} hints were checked`);
});

test('c corrects the live card either side up, with alt in the box, and never a card looked back at', () => {
  assert.equal(resolve(press('c'), ctx({ rung: 'recognise' })), 'edit');
  assert.equal(resolve(press('c'), ctx({ rung: 'recognise', revealed: true })), 'edit');
  const typing = ctx({ rung: 'dictate' });
  assert.equal(resolve(press('c', { inField: true }), typing), null, 'a letter being typed');
  assert.equal(resolve(press('c', { inField: true, alt: true }), typing), 'edit');
  assert.deepEqual(hint('edit', typing), ['alt', 'c']);
  assert.deepEqual(hint('edit', ctx({ rung: 'recognise' })), ['c']);
  assert.equal(resolve(press('c'), ctx({ browsing: true, revealed: true })), null,
    'an answered card is a record of the answer, not the word');
  assert.deepEqual(hint('edit', ctx({ idle: true })), []);
});

test('while the word is being corrected, nothing on the card behind the popup fires', () => {
  /* The popup's form takes Enter, a space lands on whichever of its buttons
     has the focus, and a digit typed into its note is a digit: without the
     gate a space on Cancel turned the card over behind it. */
  const editing = ctx({ rung: 'recognise', revealed: true, editing: true });
  for (const key of ['3', ' ', 'Enter', 's', 'e', 'c', 'd', 'ArrowLeft']) {
    assert.equal(resolve(press(key), editing), null, key);
    assert.equal(resolve(press(key, { alt: true }), editing), null, `alt ${key}`);
  }
  assert.deepEqual(hint('good', editing), [], 'and no hint says otherwise');
  assert.equal(available('show', ctx({ rung: 'recognise', editing: true })), false);
});

test('on a tap card the digits are the options face down and the grades face up', () => {
  /* Before the flip there are no grades to give, and after it there are no
     options left to tap, so one set of keys serves both without a clash. */
  const choosing = ctx({ rung: 'choose', options: 3 });
  assert.equal(resolve(press('1'), choosing), 'pick1');
  assert.equal(resolve(press('3'), choosing), 'pick3');
  assert.equal(resolve(press('4'), choosing), null, 'only three options');
  assert.deepEqual(hint('pick2', choosing), ['2']);
  assert.deepEqual(hint('good', choosing), [], 'no grade before the flip');
  const flipped = ctx({ rung: 'choose', options: 3, revealed: true });
  assert.equal(resolve(press('1'), flipped), 'again');
  assert.deepEqual(hint('pick1', flipped), []);
  assert.equal(resolve(press('1'), ctx({ rung: 'write' })), null, 'a typed card has no options');
  assert.equal(resolve(press(' '), choosing), null, 'and nothing to show: the card is answered by tapping');
});

test('the French is replayable when the device can say it, though no recording exists', () => {
  /* A word without a recording had no "play it again" and no `s` on its back,
     while the speaker on the front, which asks the device, said it fine (#81).
     What decides is whether the French can be heard, not whether it is a file. */
  const said = ctx({ rung: 'recognise', revealed: true, has: { fr: false, native: false }, canSay: true });
  assert.equal(resolve(press('s'), said), 'playModel');
  assert.deepEqual(hint('playModel', said), ['s']);
  const mute = ctx({ rung: 'recognise', revealed: true, has: { fr: false, native: false }, canSay: false });
  assert.equal(resolve(press('s'), mute), null, 'nothing here can say it');
  assert.deepEqual(hint('playModel', mute), []);
});
