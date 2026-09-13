import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  cardId, CHANNELS, exerciseLabel, HANDS_FREE, HEARD_FIRST, isChannel, isRung, lemmaOf, RUNGS,
  SAY_ALOUD, TYPED, wordKey,
} from '../src/lib/keys.js';
import { k } from './make.js';

test('a card id is the word, the channel and the rung, in that order', () => {
  assert.equal(cardId(k('bug|noun'), 'written', 'recognise'), 'bug|noun|written|recognise');
  assert.equal(wordKey('bug', 'noun'), 'bug|noun');
  assert.equal(lemmaOf(k('le bus|noun')), 'le bus', 'a lemma may hold a space, never the pos');
});

test('what counts as a channel and a rung is decided in one place', () => {
  assert.equal(isChannel('written'), true);
  assert.equal(isChannel('spoken'), false);
  assert.equal(isRung('dictate'), true);
  assert.equal(isRung('recite'), false);
  assert.equal(isRung(undefined), false);
});

test('every rung belongs to exactly one channel', () => {
  const seen = new Map<string, string>();
  for (const channel of CHANNELS) {
    for (const rung of RUNGS[channel]) {
      assert.equal(seen.has(rung), false, `${rung} is on two channels`);
      seen.set(rung, channel);
    }
  }
});

test('the four rung sets say what they mean about each rung', () => {
  /* A rung is answered by keyboard or not; its question is the French played
     aloud or not; the two are what the study screen switches on. */
  for (const rung of RUNGS.heard) {
    assert.equal(HEARD_FIRST.has(rung), true, 'the heard channel is heard first, by definition');
  }
  assert.equal([...TYPED].some((r) => HANDS_FREE.has(r)), false,
    'nothing typed can be answered on a walk');
  assert.equal([...SAY_ALOUD].every((r) => TYPED.has(r)), true,
    'the say-it-aloud prompt is for the rungs where nothing else asks');
  assert.equal([...SAY_ALOUD].some((r) => HEARD_FIRST.has(r)), false,
    'a card that played the French is not asking you to say it first');
});

test('a review row labels itself, whatever shape of id it carries', () => {
  assert.equal(exerciseLabel('written/recognise'), 'Read FR → EN');
  assert.equal(exerciseLabel('fr_en'), 'Read FR→EN', 'a row from before the ladder');
  assert.equal(exerciseLabel('something/else'), 'something/else', 'and anything else, verbatim');
});
