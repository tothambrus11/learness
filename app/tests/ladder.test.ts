/** How a word climbs: where it joins a ladder, when it moves up, and when the
 *  heard channel opens. */
import { expect, test } from 'vitest';

import { DEFAULT_SETTINGS } from '../src/lib/db';
import {
  afterAnswer,
  entryRung,
  isActive,
  legacyToChannel,
  nextRung,
  rekeyOrphans,
  settleRungs,
  streakAfter,
} from '../src/lib/ladder';
import type { LegacyCard } from '../src/lib/ladder';
import { emptyCard, grade, Rating, scheduler, State } from '../src/lib/scheduler';
import type { Card, Channel, LegacyDirection, Rung, Settings, WordKey } from '../src/lib/types';

/** The moment every card below is dated from. */
const now = new Date('2026-09-06T09:00:00Z');

/** A card whose memory is long enough that maturity alone would climb it. */
const mature = (key: WordKey, channel: Channel, rung: Rung): Card => ({
  ...emptyCard(key, channel, rung, now),
  state: State.Review,
  stability: 40,
  reps: 8,
});

/** A card as it was stored before the ladder: a real card's scheduling state
 *  keyed by one of the five old directions instead of a channel and a rung,
 *  and with the id that direction gave it. */
const legacy = (
  key: WordKey,
  direction: LegacyDirection,
  extra: Partial<Card> = {},
): LegacyCard => {
  const {
    channel: _channel,
    rung: _rung,
    ...rest
  } = emptyCard(key, 'written', 'recognise', now);
  return { ...rest, id: `${key}|${direction}`, direction, ...extra };
};

/** A row in the cards store that is not a card this version knows: an id, a
 *  sync stamp, and no ladder at all. Asserted into shape here, once, because a
 *  `Card` always has a channel and so cannot state what `legacyToChannel` and
 *  `settleRungs` both promise — to leave such a row alone. */
const unknownShape = (fields: { id: string; updatedAt?: number }): Card =>
  fields as unknown as Card;

test('a word that reads as English skips recognition; one that does not starts there', () => {
  expect(
    entryRung('written', { looks: 1.0 }),
    'la nation reads on sight; the article and the accents are what is left, and typing tests them',
  ).toBe('write');
  expect(entryRung('written', { looks: 0.3 }), 'faire does not').toBe('recognise');
  expect(entryRung('written', {}), 'no score: assume nothing').toBe('recognise');
});

test('a word that sounds like English goes straight to dictation', () => {
  expect(entryRung('heard', { sounds: 1.0 }), 'le taxi').toBe('dictate');
  expect(entryRung('heard', { sounds: 0.33 }), 'la nation, by ear').toBe('hear');
  expect(entryRung('heard', {})).toBe('hear');
});

test('the rung above, and the top', () => {
  expect(nextRung('written', 'recognise')).toBe('say');
  expect(nextRung('written', 'say')).toBe('write');
  expect(nextRung('heard', 'hear')).toBe('dictate');
  expect(nextRung('heard', 'dictate')).toBe(null);
});

test('"use it" waits for a sentence to use it in', () => {
  expect(nextRung('written', 'write', { ex: [] })).toBe(null);
  expect(nextRung('written', 'write', {})).toBe(null);
  expect(
    nextRung('written', 'write', {
      ex: [{ fr: 'Tous sont heureux.', en: 'Everyone is happy.', f: 'sont' }],
    }),
  ).toBe('use');
});

test('the five directions land on the rungs they imply', () => {
  const old = legacy('bug|noun', 'fr_en', { reps: 3, stability: 9 });
  const c = legacyToChannel(old)!;
  expect(c.id).toBe('bug|noun|written|recognise');
  expect(c.channel).toBe('written');
  expect(c.rung).toBe('recognise');
  expect(c.reps, 'the scheduling state comes along').toBe(3);
  expect('direction' in c).toBe(false);
  expect(legacyToChannel(legacy('x', 'en_fr'))?.rung).toBe('write');
  expect(legacyToChannel(legacy('x', 'audio_en'))?.rung).toBe('hear');
  expect(legacyToChannel(legacy('x', 'audio_fr'))?.rung).toBe('dictate');
});

test('speaking cards retire, and mapping is idempotent', () => {
  expect(legacyToChannel(legacy('x', 'speak'))).toBe(null);
  const done = legacyToChannel(legacy('x', 'fr_en'));
  expect(legacyToChannel(done), 'a card already on a rung is left alone').toBe(done);
  const odd = unknownShape({ id: 'q', updatedAt: 5 });
  expect(legacyToChannel(odd), 'a card of no known shape is left alone').toBe(odd);
  expect(legacyToChannel(null)).toBe(null);
});

test('one active card per channel: the highest rung, the rest retired', () => {
  const cards = settleRungs([
    emptyCard('bug|noun', 'written', 'recognise', now),
    emptyCard('bug|noun', 'written', 'write', now),
    emptyCard('bug|noun', 'heard', 'hear', now),
    unknownShape({ id: 'legacy', updatedAt: 1 }),
  ]);
  const by = Object.fromEntries(cards.filter((c) => c.id !== 'legacy').map((c) => [c.rung, c]));
  expect(by.recognise.retired).toBe(true);
  expect(by.write.retired).toBe(false);
  expect(by.hear.retired).toBe(false);
  expect(isActive(by.write) && !isActive(by.recognise)).toBeTruthy();
  expect(cards.find((c) => c.id === 'legacy')!.retired, 'not its business').toBe(undefined);
});

test('settling is a no-op on cards already settled', () => {
  const a = { ...emptyCard('a|noun', 'written', 'say', now), retired: false };
  expect(settleRungs([a])[0], 'same object back').toBe(a);
});

test('a mature card is promoted: a fresh card on the next rung, due now, and the old one retires', () => {
  const card = mature('bug|noun', 'written', 'recognise');
  const step = afterAnswer({
    card,
    rating: Rating.Good,
    word: { looks: 0.3 },
    cards: [card],
    now,
  });
  expect(step.retire).toBe(true);
  expect(step.promoted?.rung).toBe('say');
  expect(step.promoted?.state, 'a new memory, with an unknown prior').toBe(State.New);
  expect(step.promoted?.reps).toBe(0);
  expect(
    new Date(step.promoted!.due) <= now,
    'no waiting for an interval it has not earned',
  ).toBeTruthy();
});

test('one Good on a young card stays where it is', () => {
  const card = {
    ...emptyCard('bug|noun', 'written', 'recognise', now),
    state: State.Review,
    stability: 9,
    streak: streakAfter({ streak: 0 }, Rating.Good),
  };
  const step = afterAnswer({ card, rating: Rating.Good, word: {}, cards: [card], now });
  expect(step.promoted).toBe(null);
  expect(step.retire).toBe(false);
});

test('two Good in a row climb, without waiting for the calendar', () => {
  const card = {
    ...emptyCard('bug|noun', 'written', 'recognise', now),
    state: State.Learning,
    stability: 2,
    streak: streakAfter({ streak: 1 }, Rating.Good),
  };
  const step = afterAnswer({ card, rating: Rating.Good, word: {}, cards: [card], now });
  expect(step.promoted?.rung).toBe('say');
  expect(step.retire).toBe(true);
});

test('one Easy climbs at once, and an Again or a Hard resets the run', () => {
  const easy = {
    ...emptyCard('bug|noun', 'written', 'say', now),
    state: State.New,
    streak: streakAfter({ streak: 0 }, Rating.Easy),
  };
  expect(
    afterAnswer({ card: easy, rating: Rating.Easy, word: {}, cards: [easy], now }).promoted
      ?.rung,
  ).toBe('write');
  expect(streakAfter({ streak: 3 }, Rating.Again)).toBe(0);
  expect(streakAfter({ streak: 3 }, Rating.Hard)).toBe(0);
  expect(streakAfter({ streak: 3 }, Rating.Good)).toBe(4);
  expect(
    streakAfter({}, Rating.Good),
    'a card from before streaks were kept starts at one',
  ).toBe(1);
});

test('the top rung has nowhere to go', () => {
  const card = mature('bug|noun', 'heard', 'dictate');
  const step = afterAnswer({ card, rating: Rating.Easy, word: {}, cards: [card], now });
  expect(step.promoted).toBe(null);
});

test('the heard channel opens the first time the word is said and known', () => {
  const said = {
    ...emptyCard('nation|noun', 'written', 'say', now),
    state: State.Learning,
    reps: 1,
  };
  /** A word that reads as English but sounds nothing like it. */
  const word = { looks: 1.0, sounds: 0.33 };
  const no = afterAnswer({ card: said, rating: Rating.Again, word, cards: [said], now });
  expect(no.heard, 'not on a miss').toBe(null);
  const yes = afterAnswer({ card: said, rating: Rating.Good, word, cards: [said], now });
  expect(yes.heard?.channel).toBe('heard');
  expect(yes.heard?.rung, 'it sounds nothing like the English, so start by ear').toBe('hear');
  const easy = afterAnswer({
    card: said,
    rating: Rating.Good,
    word: { sounds: 1.0 },
    cards: [said],
    now,
  });
  expect(easy.heard?.rung, 'le taxi can be written down at once').toBe('dictate');
});

test('the heard channel opens once, and not from recognition alone', () => {
  const said = {
    ...emptyCard('bug|noun', 'written', 'say', now),
    reps: 1,
    state: State.Learning,
  };
  const heard = emptyCard('bug|noun', 'heard', 'hear', now);
  expect(
    afterAnswer({ card: said, rating: Rating.Good, word: {}, cards: [said, heard], now }).heard,
    'already open',
  ).toBe(null);
  const recog = {
    ...emptyCard('bug|noun', 'written', 'recognise', now),
    reps: 1,
    state: State.Learning,
  };
  expect(
    afterAnswer({ card: recog, rating: Rating.Easy, word: {}, cards: [recog], now }).heard,
    'reading it is not saying it',
  ).toBe(null);
});

test('a retired card does nothing when answered', () => {
  const card = { ...mature('bug|noun', 'written', 'recognise'), retired: true };
  const step = afterAnswer({ card, rating: Rating.Good, word: {}, cards: [card], now });
  expect(step).toEqual({ promoted: null, retire: false, heard: null });
});

test('a card follows its word when the catalogue changes the part of speech', () => {
  /** The index as `rekeyOrphans` reads it: keys and nothing else. */
  const index = [
    { k: 'vidéo|noun' },
    { k: 'bug|noun' },
    { k: 'être|verb' },
    { k: 'être|noun' },
  ];
  const old = { ...mature('vidéo|adj', 'written', 'say'), reps: 9 };
  const fine = mature('bug|noun', 'written', 'say');
  const ambiguous = mature('être|adj', 'written', 'say');
  const mine = mature('natel|noun', 'written', 'recognise');
  const moves = rekeyOrphans([old, fine, ambiguous, mine], index, new Set(['natel|noun']));
  expect(moves.length).toBe(1);
  const [from, to] = moves[0];
  expect(from.id).toBe('vidéo|adj|written|say');
  expect(to.id).toBe('vidéo|noun|written|say');
  expect(to.key).toBe('vidéo|noun');
  expect(to.reps, 'the state moves with the word').toBe(9);
  expect(to.stability).toBe(40);
});

test('a card is not moved onto a rung the word already has', () => {
  const index = [{ k: 'vidéo|noun' }];
  const old = mature('vidéo|adj', 'written', 'say');
  const already = emptyCard('vidéo|noun', 'written', 'say', now);
  expect(rekeyOrphans([old, already], index).length).toBe(0);
});

test('answering Good every time climbs recognise to say to write', () => {
  const S: Settings = { ...DEFAULT_SETTINGS };
  const f = scheduler(S);
  /** A word that neither reads nor sounds like its English, so it starts at
   *  the bottom of both ladders. */
  const word = { looks: 0.3, sounds: 0.3 };
  let cards: Card[] = [emptyCard('faire|verb', 'written', 'recognise', now)];
  let t = now;
  /** The rungs reached, in the order they were climbed. */
  const climbed: Rung[] = [];
  let answers = 0;
  for (let i = 0; i < 40 && climbed.length < 2; i++) {
    const card = cards.find((c) => c.channel === 'written' && !c.retired)!;
    const graded = grade(f, card, Rating.Good, t, S);
    graded.streak = streakAfter(card, Rating.Good);
    answers += 1;
    const step = afterAnswer({ card: graded, rating: Rating.Good, word, cards, now: t });
    if (step.retire) graded.retired = true;
    cards = cards.map((c) => (c.id === graded.id ? graded : c));
    if (step.promoted) {
      climbed.push(step.promoted.rung);
      cards.push(step.promoted);
    }
    if (step.heard && !cards.some((c) => c.channel === 'heard')) cards.push(step.heard);
    t = new Date(Math.max(new Date(graded.due).getTime(), t.getTime() + 60000));
  }
  expect(climbed, 'each promotion is a new card, starting from nothing').toEqual([
    'say',
    'write',
  ]);
  expect(answers, 'two Good per rung: recognise twice, say twice').toBe(4);
  expect(
    cards.some((c) => c.channel === 'heard'),
    'saying it opened the ear',
  ).toBeTruthy();
  const active = cards.filter((c) => c.channel === 'written' && !c.retired);
  expect(active.length).toBe(1);
  expect(active[0].rung).toBe('write');
});
