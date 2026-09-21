/** A sitting, driven the way the study screen drives it, against the real
 *  database.
 *
 *  Every rule here was the screen's own until it was moved out, and none of
 *  them had a test below the browser: grade once however many times the key
 *  is pressed, Again comes back, looking back changes nothing, a reload
 *  comes back to the same card.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Rating } from 'ts-fsrs';
import { freshApp, smallCatalogue } from './harness.js';
import type { App } from './harness.js';
import type { Sitting } from '../src/lib/sitting.svelte.js';
import { keyOf, rungOf, wordOf } from '../src/lib/queue.js';

/** A sitting over the small catalogue, dealt. `looks` lifts every word to the
 *  "write it" rung, so the cards are typed. */
async function dealt({ size = 6, typed = false, newPerDay = 3 } = {}):
  Promise<{ app: App; sitting: Sitting; Sitting: typeof Sitting }> {
  const catalogue = smallCatalogue(size);
  if (typed) for (const e of catalogue.index) e.looks = 0.9;
  const app = await freshApp({ catalogue });
  await app.db.setSetting('maxNewPerDay', newPerDay);
  const { Sitting: S } = await import('../src/lib/sitting.svelte.js');
  const sitting = new S();
  await sitting.start();
  return { app, sitting, Sitting: S };
}

test('a sitting deals its cards and the first is on screen, face down', async () => {
  const { sitting } = await dealt();
  assert.equal(sitting.loading, false);
  assert.equal(sitting.error, '');
  assert.equal(sitting.items.length, 3);
  assert.equal(keyOf(sitting.shown), 'temps|noun');
  assert.equal(sitting.revealed, false);
  assert.equal(sitting.finished, false);
  assert.equal(sitting.left, 3);
  assert.equal(sitting.typing, false, 'a recognise card is not typed');
});

test('an answer writes one review, moves on, and clears the card', async () => {
  const { app, sitting } = await dealt();
  assert.equal(await sitting.record(Rating.Good), null, 'not before the flip');
  assert.equal(sitting.reveal(), true);
  assert.equal(sitting.reveal(), false, 'and only once');
  const res = await sitting.record(Rating.Good);
  assert.ok(res);
  assert.equal((await app.db.allReviews()).length, 1);
  assert.equal(sitting.i, 1);
  assert.equal(sitting.revealed, false);
  assert.deepEqual(sitting.done, { answered: 1, right: 1, learned: 0, promoted: 0, heard: 0 });
  assert.equal(sitting.history.length, 1);
  assert.equal(sitting.history[0]?.rating, Rating.Good);
});

test('a grade pressed twice in a hurry is one grade', async () => {
  /* The second tap used to land while the first answer was still being
     written: the same card graded twice, and the next one skipped. */
  const { app, sitting } = await dealt();
  sitting.reveal();
  const [a, b] = await Promise.all([sitting.record(Rating.Good), sitting.record(Rating.Good)]);
  assert.ok(a);
  assert.equal(b, null);
  assert.equal((await app.db.allReviews()).length, 1);
  assert.equal(sitting.i, 1);
});

test('Again brings the card back a couple of cards on, not at the end', async () => {
  /* It went to the end whatever the step said. The first learning step is a
     minute, and at the pace of answering a minute is about two cards. */
  const { sitting } = await dealt({ newPerDay: 6 });
  assert.equal(sitting.items.length, 6);
  sitting.reveal();
  await sitting.record(Rating.Again);
  assert.equal(sitting.items.length, 7);
  assert.equal(keyOf(sitting.items[2]), 'temps|noun', 'after one other card');
  assert.equal(keyOf(sitting.items.at(-1)), 'train|noun', 'the end is still the end');
  assert.equal(sitting.done.right, 0);
  assert.equal(sitting.waiting.length, 0);
});

test('Good on a new card comes back after twenty-odd cards, or waits when the sitting is shorter', async () => {
  const { sitting } = await dealt();
  sitting.reveal();
  await sitting.record(Rating.Good);
  assert.equal(sitting.items.length, 3, 'ten minutes away is further than the sitting is long');
  assert.deepEqual(sitting.waiting.map((it) => keyOf(it)), ['temps|noun']);
  assert.equal(sitting.backIn, 10);
  sitting.reveal(); await sitting.record(Rating.Good);
  sitting.reveal(); await sitting.record(Rating.Good);
  assert.equal(sitting.finished, true);
  assert.equal(sitting.waiting.length, 3, 'so the end screen can say when they are back');
});

test('Again at the very end is dealt again rather than announced', async () => {
  /* "One card comes back in a minute" on the end screen is worse than seeing it. */
  const { sitting } = await dealt({ newPerDay: 1 });
  sitting.reveal();
  await sitting.record(Rating.Again);
  assert.equal(sitting.finished, false);
  assert.equal(sitting.items.length, 2);
  assert.equal(sitting.waiting.length, 0);
});

test('a typed card is judged against what was typed', async () => {
  const { sitting } = await dealt({ typed: true });
  assert.equal(sitting.typing, true);
  assert.equal(sitting.reveal(), false, 'a typed card is not turned without an answer');
  sitting.type('le temps');
  assert.equal(sitting.check(), true);
  assert.equal(sitting.verdict?.verdict, 'ok');
  assert.equal(sitting.revealed, true);
  await sitting.record(Rating.Good);
  assert.equal(sitting.typed, '', 'the box is empty for the next card');
  sitting.type('le jours');
  sitting.check();
  assert.equal(sitting.verdict?.verdict, 'close');
  assert.equal(sitting.check(), false, 'and it is not judged twice');
});

test('looking back shows the card as it was answered, and changes nothing', async () => {
  const { app, sitting } = await dealt({ typed: true });
  sitting.type('le temps'); sitting.check(); await sitting.record(Rating.Good);
  sitting.type('la jour'); sitting.check(); await sitting.record(Rating.Hard);
  assert.equal(sitting.lookBack(1), null, 'nothing newer than the live card');

  assert.equal(sitting.lookBack(-1), 'back');
  assert.equal(sitting.browsing, true);
  assert.equal(keyOf(sitting.shown), 'jour|noun');
  assert.equal(sitting.shownRevealed, true, 'an answered card is face up');
  assert.equal(sitting.shownTyped, 'la jour');
  assert.equal(sitting.shownVerdict?.verdict, 'article');
  assert.equal(await sitting.record(Rating.Good), null, 'the grade already given stands');
  assert.equal(sitting.reveal(), false);
  sitting.type('x');
  assert.equal(sitting.typed, '', 'typing reaches only the live card');
  assert.equal((await app.db.allReviews()).length, 2);

  assert.equal(sitting.lookBack(-1), 'back');
  assert.equal(keyOf(sitting.shown), 'temps|noun');
  assert.equal(sitting.canOlder, false);
  assert.equal(sitting.lookBack(-1), null, 'nothing older');
  assert.equal(sitting.lookBack(2), 'live');
  assert.equal(sitting.browsing, false);
  assert.equal(keyOf(sitting.shown), 'monde|noun');
  assert.equal(sitting.shownRevealed, false);
});

test('looking back, the right arrow steps forward and the last step lands on the live card', async () => {
  /* The bar said only "space to continue", which jumps to the live card; a
     learner two cards back had no way shown to step forward one (#53). */
  const { sitting } = await dealt();
  sitting.reveal(); await sitting.record(Rating.Good);
  sitting.reveal(); await sitting.record(Rating.Good);
  assert.equal(sitting.lookBack(-1), 'back');
  assert.equal(sitting.lookBack(-1), 'back');
  assert.equal(keyOf(sitting.shown), 'temps|noun');
  assert.equal(sitting.lookBack(1), 'back', 'one forward is the card after it');
  assert.equal(keyOf(sitting.shown), 'jour|noun');
  assert.equal(sitting.browsing, true);
  assert.equal(sitting.lookBack(1), 'live', 'one more is the live card, which wants cueing');
  assert.equal(sitting.browsing, false);
  assert.equal(keyOf(sitting.shown), 'monde|noun');
  assert.equal(sitting.lookBack(1), null, 'and there is nothing past it');
});

test('closing the study screen and coming back carries on from the same card', async () => {
  /* The queue is not kept; it is dealt again, and an answered card is no
     longer in it, so the next open lands on the card that was next. The
     day's numbers and the look-back come back with it. */
  const { sitting, Sitting } = await dealt();
  sitting.reveal(); await sitting.record(Rating.Good);
  sitting.reveal(); await sitting.record(Rating.Easy);
  const third = keyOf(sitting.shown);

  const again = new Sitting();
  await again.start();
  assert.equal(again.resumed, true);
  assert.equal(again.i, 0, 'dealt afresh, minus what was answered');
  assert.equal(keyOf(again.shown), third);
  assert.equal(again.history.length, 2);
  assert.equal(again.done.answered, 2);
  assert.equal(again.lookBack(-1), 'back');
  assert.equal(keyOf(again.shown), 'jour|noun');
  assert.deepEqual(again.waiting.map((it) => keyOf(it)), ['temps|noun'],
    'the card graded Good is on its ten-minute step, and still comes back');
});

test('the last answer finishes the sitting, and the day remembers it', async () => {
  const { app, sitting } = await dealt({ newPerDay: 2 });
  sitting.reveal(); await sitting.record(Rating.Good);
  sitting.reveal(); await sitting.record(Rating.Good);
  assert.equal(sitting.finished, true);
  assert.equal(sitting.shown, null);
  const record = await app.session.todayRecord(new Date(), app.db.DEFAULT_SETTINGS.dayStartsAt);
  assert.equal(record?.done.answered, 2);
  assert.equal(record?.history.length, 2);
  assert.equal(await app.db.getMeta('sitting'), null, 'the queue itself is not written down');
  assert.equal(sitting.reveal(), false);
});

test('a typed answer is written down like any other, verdict and all', async () => {
  /* The verdict is an object, and an object in rune state is a proxy, which
     the database's structured clone refuses: the day's record silently did
     not save after the first typed card, and the home screen said "Study"
     where it should have said "Carry on". */
  const { app, sitting, Sitting } = await dealt({ typed: true });
  sitting.type('le temps'); sitting.check(); await sitting.record(Rating.Good);
  const record = await app.session.todayRecord(new Date(), app.db.DEFAULT_SETTINGS.dayStartsAt);
  assert.equal(record?.history.length, 1);
  assert.deepEqual(record?.history[0]?.verdict, { verdict: 'ok' });
  const again = new Sitting();
  await again.start();
  assert.equal(again.resumed, true);
  assert.equal(again.history[0]?.verdict?.verdict, 'ok');
});

test('a sitting that runs past the hour the day turns starts the new day’s record', async () => {
  /* The day turns at three, not at midnight: an answer at one minute past
     twelve is the evening's, and the tally goes on. It once started again
     under the learner's hands (#70). */
  const app = await freshApp({ catalogue: smallCatalogue(6) });
  await app.db.setSetting('maxNewPerDay', 3);
  const { dayStartsAt } = await app.db.getSettings();
  assert.equal(dayStartsAt, 3);
  const { Sitting: S } = await import('../src/lib/sitting.svelte.js');
  const { ms } = await import('./make.js');
  let clock = ms(new Date(2026, 8, 10, 23, 59).getTime());
  const sitting = new S({ now: () => clock });
  await sitting.start();
  sitting.reveal(); await sitting.record(Rating.Good);
  assert.equal(sitting.done.answered, 1);

  clock = ms(new Date(2026, 8, 11, 0, 1).getTime());
  sitting.reveal(); await sitting.record(Rating.Good);
  assert.equal(sitting.done.answered, 2, 'past midnight is still the evening');
  assert.equal(sitting.history.length, 2);

  clock = ms(new Date(2026, 8, 11, 3, 1).getTime());
  sitting.reveal(); await sitting.record(Rating.Good);
  assert.equal(sitting.done.answered, 1, 'the new day starts at one');
  assert.equal(sitting.history.length, 1);
  const record = await app.session.todayRecord(new Date(clock), dayStartsAt);
  assert.equal(record?.done.answered, 1);
});

test('a correction made from the card is on the card at once', async () => {
  /* The word behind a card is looked up when the sitting opens, so a
     correction made on the words screen showed at the next open and not
     before. Made from the card itself, in the popup, it has to show on that
     card without the sitting moving. */
  const { app, sitting } = await dealt();
  const key = wordOf(sitting.shown)!.k;
  assert.deepEqual(wordOf(sitting.shown)?.en, ['time']);
  await app.words.correctWord(key, { en: ['weather'] });
  await sitting.refreshWord(key);
  assert.deepEqual(wordOf(sitting.shown)?.en, ['weather']);
  assert.equal(sitting.i, 0, 'the same card');
  assert.equal(sitting.revealed, false, 'still face down');
  assert.equal(sitting.items.length, 3, 'and the queue as it was');

  /* And on a card looked back at, as a reload would show it. */
  sitting.reveal();
  await sitting.record(Rating.Good);
  await app.words.correctWord(key, { en: ['season'] });
  await sitting.refreshWord(key);
  assert.equal(sitting.lookBack(-1), 'back');
  assert.deepEqual(wordOf(sitting.shown)?.en, ['season']);
  assert.equal(sitting.past?.rating, Rating.Good, 'the grade given stands');
});

test('the app is busy while a card is face up, and not otherwise', async () => {
  /* What the automatic sync asks before it rewrites cards under the screen. */
  const { sitting } = await dealt();
  const { isStudying } = await import('../src/lib/sitting.svelte.js');
  assert.equal(isStudying(), false);
  sitting.reveal();
  assert.equal(isStudying(), true);
  await sitting.record(Rating.Good);
  assert.equal(isStudying(), false);
  sitting.reveal();
  sitting.stop();
  assert.equal(isStudying(), false, 'off the screen, nothing is busy');
});


test('a tap card is answered by finding the right word, and graded on the first tap', async () => {
  /* Graded as a Hard, a wrong-then-right was a pass, and a guesser on three
     buttons never lapsed. The retry teaches; the first tap grades. */
  const { entry, word } = await import('./make.js');
  const sur = word({ k: 'sur|prep', fr: 'sur', answer: 'sur', lemma: 'sur', pos: 'prep', en: ['on'],
    lvl: 0, kind: 'function', contrast: [(await import('./make.js')).k('sous|prep')],
    ex: [{ fr: 'Le livre est sur la table.', en: 'The book is on the table.', f: 'sur' }] });
  const catalogue = { index: [entry({ k: 'sur|prep', fr: 'sur', en: ['on'], lvl: 0, m: 0, kind: 'function' })],
    words: [], functionWords: [sur] };
  const app = await freshApp({ catalogue });
  const { card } = await import('./make.js');
  await app.db.putCard(card('sur|prep', 'sense', 'choose'));
  const { Sitting: S } = await import('../src/lib/sitting.svelte.js');
  const sitting = new S();
  await sitting.start();
  assert.equal(rungOf(sitting.shown), 'choose');
  assert.equal(sitting.choosing, true);
  assert.equal(sitting.reveal(), false, 'a tap card is not turned by looking');
  assert.equal(sitting.pick('sous'), false, 'the wrong word: the card stays face down');
  assert.deepEqual(sitting.picked, ['sous']);
  assert.equal(sitting.revealed, false);
  assert.equal(sitting.pick('sous'), false, 'and cannot be tapped again');
  assert.equal(sitting.pick('sur'), true, 'the right one turns it over');
  assert.equal(sitting.verdict?.verdict, 'no', 'graded on the first tap');
  await sitting.record(Rating.Again);
  assert.equal(sitting.history[0]?.typed, 'sous', 'what was tapped first is what is remembered');
  assert.deepEqual(sitting.picked, [], 'and the next card starts clean');
});

test('a grammar exercise is filled cell by cell, checked at once, and moved on from without a grade', async () => {
  const { bit, card: makeCard, entry, word: makeWord } = await import('./make.js');
  const { State } = await import('ts-fsrs');
  const parler = {
    lemma: 'parler', aux: 'avoir', shape: '', compound: [], impersonal: [], links: [], examples: {},
    groups: [{ id: 'pres', mood: '', tense: 'Présent', stem: 'parl', irregular: false, note: '',
      rows: [['je', 'e'], ['tu', 'es'], ['il', 'e'], ['nous', 'ons'], ['vous', 'ez'], ['ils', 'ent']]
        .map(([p, e]) => ({ p: p!, s: 'parl', e: e!, f: `parl${e}` })) }],
  };
  const catalogue = smallCatalogue(2);
  catalogue.index.push(entry({ k: 'parler|verb', fr: 'parler', en: ['to speak'], lvl: 1, m: 0.0001, looks: 0.1 }));
  catalogue.words.push(makeWord({ k: 'parler|verb', fr: 'parler', answer: 'parler', lemma: 'parler',
    pos: 'verb', en: ['to speak'], lvl: 1, conj: parler }));
  const app = await freshApp({ catalogue });
  await app.db.setSetting('maxNewPerDay', 0);
  await app.db.putCard(makeCard('parler|verb', 'written', 'write', {
    reps: 6, state: State.Review, stability: 30, difficulty: 5,
    due: new Date(Date.now() - 86_400_000), last_review: new Date(Date.now() - 10 * 86_400_000),
  }));
  await app.db.putBit(bit('V.pres-er'));
  const { Sitting: S } = await import('../src/lib/sitting.svelte.js');
  const sitting = new S();
  await sitting.start();
  assert.deepEqual(sitting.items.map((it) => it.kind), ['word', 'rule']);

  /* The word card first, then the table. */
  sitting.type('parler'); sitting.check(); await sitting.record(Rating.Good);
  assert.equal(sitting.drilling, true);
  assert.equal(sitting.typing, true, 'the cells are typed into, so the screen focuses the first');
  assert.equal(sitting.reveal(), false, 'a table is not turned by looking');
  assert.equal(await sitting.next(), null, 'nor moved on from before it is checked');
  for (const [i, v] of ['parle', 'parles', 'parle', 'parlent', 'parlez', 'parlent'].entries()) sitting.typeCell(i, v);
  assert.equal(sitting.check(), true);
  assert.equal(sitting.revealed, true);
  assert.equal(sitting.verdict?.verdict, 'no', 'nous parlent is not right');
  assert.deepEqual(sitting.parts.map((p) => p.ok), [true, true, true, false, true, true]);
  assert.equal(await sitting.record(Rating.Good), null, 'an exercise has no grade to press');

  const res = await sitting.next();
  assert.ok(res);
  assert.equal(res.rules[0]?.id, 'V.pres-er|produce');
  assert.equal(res.attempt.grades['V.pres-er|produce'], Rating.Hard, 'one cell wrong');
  assert.equal(sitting.done.answered, 2);
  assert.equal(sitting.done.right, 1, 'a table with a slip is not a right answer');
  assert.deepEqual(sitting.cells, [], 'clean for the next card');
  assert.equal(sitting.finished, true);
  assert.equal(sitting.history[1]?.item.kind, 'rule');
  assert.equal(sitting.history[1]?.rating, Rating.Hard, 'the look-back says what the rule got');
  assert.deepEqual(sitting.history[1]?.parts?.map((p) => p.got)[3], 'parlent');

  /* Looked back at, the table shows the cells as they were answered. */
  sitting.lookBack(-1);
  assert.deepEqual(sitting.shownCells, ['parle', 'parles', 'parle', 'parlent', 'parlez', 'parlent']);
  assert.equal(sitting.shownParts.length, 6);
  assert.equal((await app.db.allAttempts()).length, 1);
});

test('an exercise said aloud is turned by looking, judged cell by cell, and moved on from only once every cell is', async () => {
  const { bit } = await import('./make.js');
  const app = await freshApp({ catalogue: smallCatalogue(2) });
  await app.db.setSetting('maxNewPerDay', 0);
  await app.db.putBit(bit('N.units'));
  const { Sitting: S } = await import('../src/lib/sitting.svelte.js');
  /* The dealer picks among written, said and heard; the said one is what
     this drives, so the others are answered first if they come. */
  let sitting = new S();
  await sitting.start();
  for (let n = 0; n < 6 && sitting.current?.kind === 'rule' && sitting.current.instance.face !== 'say'; n += 1) {
    sitting.typeCell(0, 'x'); sitting.check(); await sitting.next();
    sitting = new S(); await sitting.start();
  }
  const live = sitting.current;
  assert.ok(live?.kind === 'rule' && live.instance.face === 'say', `a said number came up: ${live?.kind === 'rule' ? live.instance.id : live?.kind}`);
  assert.equal(sitting.typing, false, 'nothing to type');
  assert.equal(sitting.check(), false);
  assert.equal(sitting.reveal(), true, 'turned by looking');
  assert.equal(sitting.judged, false, 'not judged yet');
  assert.equal(await sitting.next(), null, 'and not moved on from until it is');
  sitting.judge(true);
  assert.equal(sitting.judged, true);
  assert.equal(sitting.parts[0]?.ok, true);
  const res = await sitting.next();
  assert.ok(res);
  assert.equal(res.attempt.face, 'say');
  assert.equal(res.attempt.parts[0]?.got, res.attempt.parts[0]?.expected, 'said right: what was said is the model');
});
