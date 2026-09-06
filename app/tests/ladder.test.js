import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterAnswer, entryRung, isActive, legacyToChannel, nextRung, rekeyOrphans, settleRungs,
} from '../src/lib/ladder.js';
import { Rating, State, emptyCard, grade, scheduler } from '../src/lib/scheduler.js';
import { DEFAULT_SETTINGS } from '../src/lib/db.js';

const now = new Date('2026-09-06T09:00:00Z');
const mature = (key, channel, rung) => ({
  ...emptyCard(key, channel, rung, now), state: State.Review, stability: 40, reps: 8,
});

test('a word that reads as English skips recognition; one that does not starts there', () => {
  assert.equal(entryRung('written', { looks: 1.0 }), 'say', 'la nation reads on sight');
  assert.equal(entryRung('written', { looks: 0.3 }), 'recognise', 'faire does not');
  assert.equal(entryRung('written', {}), 'recognise', 'no score: assume nothing');
});

test('a word that sounds like English goes straight to dictation', () => {
  assert.equal(entryRung('heard', { sounds: 1.0 }), 'dictate', 'le taxi');
  assert.equal(entryRung('heard', { sounds: 0.33 }), 'hear', 'la nation, by ear');
  assert.equal(entryRung('heard', {}), 'hear');
});

test('the rung above, and the top', () => {
  assert.equal(nextRung('written', 'recognise'), 'say');
  assert.equal(nextRung('written', 'say'), 'write');
  assert.equal(nextRung('heard', 'hear'), 'dictate');
  assert.equal(nextRung('heard', 'dictate'), null);
});

test('"use it" waits for a sentence to use it in', () => {
  assert.equal(nextRung('written', 'write', { ex: [] }), null);
  assert.equal(nextRung('written', 'write', {}), null);
  assert.equal(nextRung('written', 'write', { ex: [{ fr: 'Tous sont heureux.' }] }), 'use');
});

test('the five directions land on the rungs they imply', () => {
  const old = { id: 'bug|noun|fr_en', key: 'bug|noun', direction: 'fr_en', reps: 3, stability: 9 };
  const c = legacyToChannel(old);
  assert.equal(c.id, 'bug|noun|written|recognise');
  assert.equal(c.channel, 'written');
  assert.equal(c.rung, 'recognise');
  assert.equal(c.reps, 3, 'the scheduling state comes along');
  assert.equal('direction' in c, false);
  assert.equal(legacyToChannel({ key: 'x', direction: 'en_fr' }).rung, 'write');
  assert.equal(legacyToChannel({ key: 'x', direction: 'audio_en' }).rung, 'hear');
  assert.equal(legacyToChannel({ key: 'x', direction: 'audio_fr' }).rung, 'dictate');
});

test('speaking cards retire, and mapping is idempotent', () => {
  assert.equal(legacyToChannel({ key: 'x', direction: 'speak' }), null);
  const done = legacyToChannel({ key: 'x', direction: 'fr_en' });
  assert.equal(legacyToChannel(done), done, 'a card already on a rung is left alone');
  const odd = { id: 'q', updatedAt: 5 };
  assert.equal(legacyToChannel(odd), odd, 'a card of no known shape is left alone');
  assert.equal(legacyToChannel(null), null);
});

test('one active card per channel: the highest rung, the rest retired', () => {
  const cards = settleRungs([
    emptyCard('bug|noun', 'written', 'recognise', now),
    emptyCard('bug|noun', 'written', 'write', now),
    emptyCard('bug|noun', 'heard', 'hear', now),
    { id: 'legacy', updatedAt: 1 },
  ]);
  const by = Object.fromEntries(cards.filter((c) => c.id !== 'legacy').map((c) => [c.rung, c]));
  assert.equal(by.recognise.retired, true);
  assert.equal(by.write.retired, false);
  assert.equal(by.hear.retired, false);
  assert.ok(isActive(by.write) && !isActive(by.recognise));
  assert.equal(cards.find((c) => c.id === 'legacy').retired, undefined, 'not its business');
});

test('settling is a no-op on cards already settled', () => {
  const a = { ...emptyCard('a|noun', 'written', 'say', now), retired: false };
  assert.equal(settleRungs([a])[0], a, 'same object back');
});

test('a mature card is promoted: a fresh card on the next rung, due now, and the old one retires', () => {
  const card = mature('bug|noun', 'written', 'recognise');
  const step = afterAnswer({ card, rating: Rating.Good, word: { looks: 0.3 }, cards: [card], now });
  assert.equal(step.retire, true);
  assert.equal(step.promoted.rung, 'say');
  assert.equal(step.promoted.state, State.New, 'a new memory, with an unknown prior');
  assert.equal(step.promoted.reps, 0);
  assert.ok(new Date(step.promoted.due) <= now, 'no waiting for an interval it has not earned');
});

test('a card that is not yet mature stays where it is', () => {
  const card = { ...emptyCard('bug|noun', 'written', 'recognise', now), state: State.Review, stability: 9 };
  const step = afterAnswer({ card, rating: Rating.Good, word: {}, cards: [card], now });
  assert.equal(step.promoted, null);
  assert.equal(step.retire, false);
});

test('the top rung has nowhere to go', () => {
  const card = mature('bug|noun', 'heard', 'dictate');
  const step = afterAnswer({ card, rating: Rating.Easy, word: {}, cards: [card], now });
  assert.equal(step.promoted, null);
});

test('the heard channel opens the first time the word is said and known', () => {
  const said = { ...emptyCard('nation|noun', 'written', 'say', now), state: State.Learning, reps: 1 };
  const word = { looks: 1.0, sounds: 0.33 };
  const no = afterAnswer({ card: said, rating: Rating.Again, word, cards: [said], now });
  assert.equal(no.heard, null, 'not on a miss');
  const yes = afterAnswer({ card: said, rating: Rating.Good, word, cards: [said], now });
  assert.equal(yes.heard.channel, 'heard');
  assert.equal(yes.heard.rung, 'hear', 'it sounds nothing like the English, so start by ear');
  const easy = afterAnswer({ card: said, rating: Rating.Good, word: { sounds: 1.0 }, cards: [said], now });
  assert.equal(easy.heard.rung, 'dictate', 'le taxi can be written down at once');
});

test('the heard channel opens once, and not from recognition alone', () => {
  const said = { ...emptyCard('bug|noun', 'written', 'say', now), reps: 1, state: State.Learning };
  const heard = emptyCard('bug|noun', 'heard', 'hear', now);
  assert.equal(afterAnswer({ card: said, rating: Rating.Good, word: {}, cards: [said, heard], now }).heard,
    null, 'already open');
  const recog = { ...emptyCard('bug|noun', 'written', 'recognise', now), reps: 1, state: State.Learning };
  assert.equal(afterAnswer({ card: recog, rating: Rating.Easy, word: {}, cards: [recog], now }).heard,
    null, 'reading it is not saying it');
});

test('a retired card does nothing when answered', () => {
  const card = { ...mature('bug|noun', 'written', 'recognise'), retired: true };
  const step = afterAnswer({ card, rating: Rating.Good, word: {}, cards: [card], now });
  assert.deepEqual(step, { promoted: null, retire: false, heard: null });
});

test('a card follows its word when the catalogue changes the part of speech', () => {
  const index = [{ k: 'vidéo|noun' }, { k: 'bug|noun' }, { k: 'être|verb' }, { k: 'être|noun' }];
  const old = { ...mature('vidéo|adj', 'written', 'say'), reps: 9 };
  const fine = mature('bug|noun', 'written', 'say');
  const ambiguous = mature('être|adj', 'written', 'say');
  const mine = mature('natel|noun', 'written', 'recognise');
  const moves = rekeyOrphans([old, fine, ambiguous, mine], index, new Set(['natel|noun']));
  assert.equal(moves.length, 1);
  const [from, to] = moves[0];
  assert.equal(from.id, 'vidéo|adj|written|say');
  assert.equal(to.id, 'vidéo|noun|written|say');
  assert.equal(to.key, 'vidéo|noun');
  assert.equal(to.reps, 9, 'the state moves with the word');
  assert.equal(to.stability, 40);
});

test('a card is not moved onto a rung the word already has', () => {
  const index = [{ k: 'vidéo|noun' }];
  const old = mature('vidéo|adj', 'written', 'say');
  const already = emptyCard('vidéo|noun', 'written', 'say', now);
  assert.equal(rekeyOrphans([old, already], index).length, 0);
});

test('the whole climb, driven by the scheduler', () => {
  /* Good every time: recognise matures, promotes to say, which matures,
     promotes to write. Each promotion is a new card starting from nothing. */
  const S = { ...DEFAULT_SETTINGS };
  const f = scheduler(S);
  const word = { looks: 0.3, sounds: 0.3 };
  let cards = [emptyCard('faire|verb', 'written', 'recognise', now)];
  let t = now;
  const climbed = [];
  for (let i = 0; i < 40 && climbed.length < 2; i++) {
    const card = cards.find((c) => c.channel === 'written' && !c.retired);
    const graded = grade(f, card, Rating.Good, t, S);
    const step = afterAnswer({ card: graded, rating: Rating.Good, word, cards, now: t });
    if (step.retire) graded.retired = true;
    cards = cards.map((c) => (c.id === graded.id ? graded : c));
    if (step.promoted) { climbed.push(step.promoted.rung); cards.push(step.promoted); }
    if (step.heard && !cards.some((c) => c.channel === 'heard')) cards.push(step.heard);
    t = new Date(Math.max(new Date(graded.due), t.getTime() + 60000));
  }
  assert.deepEqual(climbed, ['say', 'write']);
  assert.ok(cards.some((c) => c.channel === 'heard'), 'saying it opened the ear');
  const active = cards.filter((c) => c.channel === 'written' && !c.retired);
  assert.equal(active.length, 1);
  assert.equal(active[0].rung, 'write');
});
