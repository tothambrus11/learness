import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  afterAnswer, entryChannel, entryRung, isActive, legacyToChannel, nextRung, rekeyOrphans,
  settleRungs, statusOf, streakAfter,
} from '../src/lib/ladder.js';
import { Rating, State, grade, scheduler } from '../src/lib/scheduler.js';
import type { Channel, Rung } from '../src/lib/keys.js';
import type { LadderCard } from '../src/lib/model.js';
import { card as made, entry, k, legacyCard } from './make.js';
import { DEFAULT_SETTINGS } from '../src/lib/db.js';

const now = new Date('2026-09-06T09:00:00Z');
const mature = (key: string, channel: Channel, rung: Rung): LadderCard =>
  made(key, channel, rung, { state: State.Review, stability: 40, reps: 8 }, now);

test('a word that reads as English skips recognition; one that does not starts there', () => {
  assert.equal(entryRung('written', { looks: 1.0 }), 'write',
    'la nation reads on sight; the article and the accents are what is left, and typing tests them');
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
  assert.equal(
    nextRung('written', 'write', { ex: [{ fr: 'Tous sont heureux.', en: 'All are happy.', f: 'sont' }] }),
    'use');
});

test('the five directions land on the rungs they imply', () => {
  const old = legacyCard('bug|noun', 'fr_en', { reps: 3, stability: 9 });
  const c = legacyToChannel(old);
  assert.equal(c?.id, 'bug|noun|written|recognise');
  assert.equal(c?.channel, 'written');
  assert.equal(c?.rung, 'recognise');
  assert.equal(c?.reps, 3, 'the scheduling state comes along');
  assert.equal('direction' in (c ?? {}), false);
  assert.equal(legacyToChannel(legacyCard('x|noun', 'en_fr'))?.rung, 'write');
  assert.equal(legacyToChannel(legacyCard('x|noun', 'audio_en'))?.rung, 'hear');
  assert.equal(legacyToChannel(legacyCard('x|noun', 'audio_fr'))?.rung, 'dictate');
});

test('speaking cards retire, and mapping is idempotent', () => {
  assert.equal(legacyToChannel(legacyCard('x|noun', 'speak')), null);
  const done = legacyToChannel(legacyCard('x|noun', 'fr_en'));
  assert.equal(legacyToChannel(done), done, 'a card already on a rung is left alone');
  /* Neither a rung nor a direction: nothing to place it by. */
  const { direction: _gone, ...odd } = legacyCard('q|noun', 'fr_en');
  assert.equal(legacyToChannel(odd), odd, 'a card of no known shape is left alone');
  assert.equal(legacyToChannel(null), null);
});

test('one active card per channel: the highest rung, the rest retired', () => {
  const cards = settleRungs([
    made('bug|noun', 'written', 'recognise', {}, now),
    made('bug|noun', 'written', 'write', {}, now),
    made('bug|noun', 'heard', 'hear', {}, now),
    legacyCard('legacy|noun', 'fr_en'),
  ]);
  const legacyId = legacyCard('legacy|noun', 'fr_en').id;
  const by = new Map(cards.filter((c) => c.id !== legacyId).map((c) => [c.rung, c]));
  assert.equal(by.get('recognise')?.retired, true);
  assert.equal(by.get('write')?.retired, false);
  assert.equal(by.get('hear')?.retired, false);
  assert.ok(isActive(by.get('write')) && !isActive(by.get('recognise')));
  assert.equal(cards.find((c) => c.id === legacyId)?.retired, undefined, 'not its business');
});

test('settling is a no-op on cards already settled', () => {
  const a = { ...made('a|noun', 'written', 'say', {}, now), retired: false };
  assert.equal(settleRungs([a])[0], a, 'same object back');
});

test('a mature card is promoted: a fresh card on the next rung, due now, and the old one retires', () => {
  const known = mature('bug|noun', 'written', 'recognise');
  const step = afterAnswer(
    { card: known, rating: Rating.Good, word: { looks: 0.3 }, cards: [known], now });
  assert.equal(step.retire, true);
  assert.equal(step.promoted!.rung, 'say');
  assert.equal(step.promoted!.state, State.New, 'a new memory, with an unknown prior');
  assert.equal(step.promoted!.reps, 0);
  assert.ok(new Date(step.promoted!.due) <= now, 'no waiting for an interval it has not earned');
});

test('one Good on a young card stays where it is', () => {
  const young = { ...made('bug|noun', 'written', 'recognise', {}, now), state: State.Review,
    stability: 9, streak: streakAfter({ streak: 0 }, Rating.Good) };
  const step = afterAnswer({ card: young, rating: Rating.Good, word: {}, cards: [young], now });
  assert.equal(step.promoted, null);
  assert.equal(step.retire, false);
});

test('two Good in a row climb, without waiting for the calendar', () => {
  const twice = { ...made('bug|noun', 'written', 'recognise', {}, now), state: State.Learning,
    stability: 2, streak: streakAfter({ streak: 1 }, Rating.Good) };
  const step = afterAnswer({ card: twice, rating: Rating.Good, word: {}, cards: [twice], now });
  assert.equal(step.promoted?.rung, 'say');
  assert.equal(step.retire, true);
});

test('one Easy climbs at once, and an Again or a Hard resets the run', () => {
  const easy = { ...made('bug|noun', 'written', 'say', {}, now), state: State.New,
    streak: streakAfter({ streak: 0 }, Rating.Easy) };
  assert.equal(afterAnswer({ card: easy, rating: Rating.Easy, word: {}, cards: [easy], now }).promoted?.rung, 'write');
  assert.equal(streakAfter({ streak: 3 }, Rating.Again), 0);
  assert.equal(streakAfter({ streak: 3 }, Rating.Hard), 0);
  assert.equal(streakAfter({ streak: 3 }, Rating.Good), 4);
  assert.equal(streakAfter({}, Rating.Good), 1, 'a card from before streaks were kept starts at one');
});

test('the top rung has nowhere to go', () => {
  const top = mature('bug|noun', 'heard', 'dictate');
  const step = afterAnswer({ card: top, rating: Rating.Easy, word: {}, cards: [top], now });
  assert.equal(step.promoted, null);
});

test('the heard channel opens the first time the word is said and known', () => {
  const said = { ...made('nation|noun', 'written', 'say', {}, now), state: State.Learning, reps: 1 };
  const word = { looks: 1.0, sounds: 0.33 };
  const no = afterAnswer({ card: said, rating: Rating.Again, word, cards: [said], now });
  assert.equal(no.heard, null, 'not on a miss');
  const yes = afterAnswer({ card: said, rating: Rating.Good, word, cards: [said], now });
  assert.equal(yes.heard!.channel, 'heard');
  assert.equal(yes.heard!.rung, 'hear', 'it sounds nothing like the English, so start by ear');
  const easy = afterAnswer({ card: said, rating: Rating.Good, word: { sounds: 1.0 }, cards: [said], now });
  assert.equal(easy.heard!.rung, 'dictate', 'le taxi can be written down at once');
});

test('the heard channel opens once, and not from recognition alone', () => {
  const said = { ...made('bug|noun', 'written', 'say', {}, now), reps: 1, state: State.Learning };
  const heard = made('bug|noun', 'heard', 'hear', {}, now);
  assert.equal(afterAnswer({ card: said, rating: Rating.Good, word: {}, cards: [said, heard], now }).heard,
    null, 'already open');
  const recog = { ...made('bug|noun', 'written', 'recognise', {}, now), reps: 1, state: State.Learning };
  assert.equal(afterAnswer({ card: recog, rating: Rating.Easy, word: {}, cards: [recog], now }).heard,
    null, 'reading it is not saying it');
});

test('a retired card does nothing when answered', () => {
  const retired = { ...mature('bug|noun', 'written', 'recognise'), retired: true };
  const step = afterAnswer(
    { card: retired, rating: Rating.Good, word: {}, cards: [retired], now });
  assert.deepEqual(step, { promoted: null, retire: false, heard: null, form: null });
});

test('a card follows its word when the catalogue changes the part of speech', () => {
  const index = ['vidéo|noun', 'bug|noun', 'être|verb', 'être|noun'].map((key) => entry({ k: key }));
  const old = { ...mature('vidéo|adj', 'written', 'say'), reps: 9 };
  const fine = mature('bug|noun', 'written', 'say');
  const ambiguous = mature('être|adj', 'written', 'say');
  const mine = mature('natel|noun', 'written', 'recognise');
  const moves = rekeyOrphans([old, fine, ambiguous, mine], index, new Set([k('natel|noun')]));
  assert.equal(moves.length, 1);
  const [from, to] = moves[0]!;
  assert.equal(from.id, 'vidéo|adj|written|say');
  assert.equal(to.id, 'vidéo|noun|written|say');
  assert.equal(to.key, 'vidéo|noun');
  assert.equal(to.reps, 9, 'the state moves with the word');
  assert.equal(to.stability, 40);
});

test('a card is not moved onto a rung the word already has', () => {
  const index = [entry({ k: 'vidéo|noun' })];
  const old = mature('vidéo|adj', 'written', 'say');
  const already = made('vidéo|noun', 'written', 'say', {}, now);
  assert.equal(rekeyOrphans([old, already], index).length, 0);
});

test('the whole climb, driven by the scheduler', () => {
  /* Good every time: recognise matures, promotes to say, which matures,
     promotes to write. Each promotion is a new card starting from nothing. */
  const S = { ...DEFAULT_SETTINGS };
  const f = scheduler(S);
  const word = { looks: 0.3, sounds: 0.3 };
  let cards: LadderCard[] = [made('faire|verb', 'written', 'recognise', {}, now)];
  let t = now;
  const climbed: string[] = [];
  let answers = 0;
  for (let i = 0; i < 40 && climbed.length < 2; i++) {
    const live = cards.find((c) => c.channel === 'written' && !c.retired);
    assert.ok(live, 'the written channel always has one active card');
    const graded = grade(f, live, Rating.Good, t, S);
    graded.streak = streakAfter(live, Rating.Good);
    answers += 1;
    const step = afterAnswer({ card: graded, rating: Rating.Good, word, cards, now: t });
    if (step.retire) graded.retired = true;
    cards = cards.map((c) => (c.id === graded.id ? graded : c));
    if (step.promoted) { climbed.push(step.promoted.rung); cards.push(step.promoted); }
    if (step.heard && !cards.some((c) => c.channel === 'heard')) cards.push(step.heard);
    t = new Date(Math.max(new Date(graded.due).getTime(), t.getTime() + 60000));
  }
  assert.deepEqual(climbed, ['say', 'write']);
  assert.equal(answers, 4, 'two Good per rung: recognise twice, say twice');
  assert.ok(cards.some((c) => c.channel === 'heard'), 'saying it opened the ear');
  const active = cards.filter((c) => c.channel === 'written' && !c.retired);
  assert.equal(active.length, 1);
  assert.equal(active[0]?.rung, 'write');
});

test('a function word starts on the sense channel, at the meeting, whatever its score', () => {
  /* A function word has no `looks`, and with none it fell through to
     "recognise" — for sur, the card "sur → on / about / over", which is the
     card DESIGN.md excluded these words to avoid. */
  assert.equal(entryChannel({ kind: 'function' }), 'sense');
  assert.equal(entryChannel({}), 'written');
  assert.equal(entryChannel(null), 'written');
  assert.equal(entryRung('sense', { kind: 'function' }), 'meet');
  assert.equal(entryRung('sense', { kind: 'function', looks: 1.0 }), 'meet');
});

test('the sense ladder is met, chosen, then written into the gap, and needs a sentence at each step', () => {
  const sentence = { fr: 'Le livre est sur la table.', en: 'The book is on the table.', f: 'sur' };
  assert.equal(nextRung('sense', 'meet', { ex: [sentence] }), 'choose');
  assert.equal(nextRung('sense', 'choose', { ex: [sentence] }), 'fill');
  assert.equal(nextRung('sense', 'fill', { ex: [sentence] }), null);
  assert.equal(nextRung('sense', 'meet', { ex: [] }), null, 'nothing to choose from');
});

const partir = {
  lemma: 'partir', aux: 'être', shape: '', compound: [], impersonal: [], links: [],
  groups: [
    { id: 'pres', mood: '', tense: 'Présent', stem: '', irregular: false, note: '',
      rows: [{ p: 'je', s: 'par', e: 's', f: 'pars' }] },
    { id: 'hist', mood: '', tense: 'Passé simple', stem: '', irregular: false, note: '',
      rows: [{ p: 'je', s: 'part', e: 'is', f: 'partis' }] },
  ],
  examples: {
    pc: [{ fr: 'Il est parti.', en: 'He left.', f: 'est parti' }],
    imp: [{ fr: 'Il partait.', en: 'He was leaving.', f: 'partait' }],
  },
};

test('a verb starts its forms at the which-time card when it has two tenses to tell apart', () => {
  assert.equal(entryRung('form', { conj: partir }), 'tense');
  const onlyPresent = { ...partir, examples: { pres: [{ fr: 'Je pars.', en: '', f: 'pars' }] } };
  assert.equal(entryRung('form', { conj: onlyPresent }), 'voice', 'one tense is nothing to choose');
  assert.equal(nextRung('form', 'tense', { conj: partir }), 'voice');
  assert.equal(nextRung('form', 'voice', { conj: partir }), null);
  const literaryOnly = { ...partir, groups: partir.groups.filter((g) => g.id === 'hist') };
  assert.equal(nextRung('form', 'tense', { conj: literaryOnly }), null,
    'the passé simple is read, never said');
});

test('the form channel opens once the verb is known, and once only', () => {
  const learning = { ...made('partir|verb', 'written', 'write', {}, now), state: State.Review,
    stability: 5, reps: 3 };
  const early = afterAnswer({ card: learning, rating: Rating.Good, word: { conj: partir },
    cards: [learning], now });
  assert.equal(early.form, null, 'not before the word itself is known');

  const known = mature('partir|verb', 'written', 'write');
  const step = afterAnswer({ card: known, rating: Rating.Good, word: { conj: partir },
    cards: [known], now });
  assert.equal(step.form?.channel, 'form');
  assert.equal(step.form?.rung, 'tense');
  assert.equal(step.form?.state, State.New);

  const open = made('partir|verb', 'form', 'tense', {}, now);
  assert.equal(afterAnswer({ card: known, rating: Rating.Good, word: { conj: partir },
    cards: [known, open], now }).form, null, 'already open');
  assert.equal(afterAnswer({ card: mature('bug|noun', 'written', 'write'), rating: Rating.Good,
    word: {}, cards: [], now }).form, null, 'a noun has no forms');
});

test('where a word stands is read off its written card, or its sense card', () => {
  const at = new Date('2026-03-01T12:00:00Z');
  const fresh = made('natel|noun');
  assert.equal(statusOf(k('natel|noun'), [fresh], at), 'up next');
  assert.equal(statusOf(k('nothing|noun'), [fresh], at), 'not started');
  const learning = made('bus|noun', 'written', 'recognise',
    { state: State.Review, stability: 3, due: new Date('2026-03-04T12:00:00Z') });
  assert.equal(statusOf(k('bus|noun'), [learning], at), 'learning');
  assert.equal(statusOf(k('bus|noun'), [learning], new Date('2026-03-05T00:00:00Z')), 'due');
  const known = made('jour|noun', 'written', 'write',
    { state: State.Review, stability: 40, due: new Date('2026-04-01T12:00:00Z') });
  assert.equal(statusOf(k('jour|noun'), [known], at), 'known');
  /* A function word has no written card; its sense card says where it is. */
  assert.equal(statusOf(k('dans|prep'), [made('dans|prep', 'sense', 'meet')], at), 'up next');
  /* A retired rung is history, not the word's place. */
  const retired = made('pont|noun', 'written', 'recognise', { retired: true });
  assert.equal(statusOf(k('pont|noun'), [retired], at), 'not started');
});
