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
  assert.equal(sitting.shown?.card.key, 'temps|noun');
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

test('Again puts the card back at the end of the queue', async () => {
  const { sitting } = await dealt();
  sitting.reveal();
  await sitting.record(Rating.Again);
  assert.equal(sitting.items.length, 4);
  assert.equal(sitting.items.at(-1)?.card.key, 'temps|noun');
  assert.equal(sitting.done.right, 0);
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
  assert.equal(sitting.shown?.card.key, 'jour|noun');
  assert.equal(sitting.shownRevealed, true, 'an answered card is face up');
  assert.equal(sitting.shownTyped, 'la jour');
  assert.equal(sitting.shownVerdict?.verdict, 'article');
  assert.equal(await sitting.record(Rating.Good), null, 'the grade already given stands');
  assert.equal(sitting.reveal(), false);
  sitting.type('x');
  assert.equal(sitting.typed, '', 'typing reaches only the live card');
  assert.equal((await app.db.allReviews()).length, 2);

  assert.equal(sitting.lookBack(-1), 'back');
  assert.equal(sitting.shown?.card.key, 'temps|noun');
  assert.equal(sitting.canOlder, false);
  assert.equal(sitting.lookBack(-1), null, 'nothing older');
  assert.equal(sitting.lookBack(2), 'live');
  assert.equal(sitting.browsing, false);
  assert.equal(sitting.shown?.card.key, 'monde|noun');
  assert.equal(sitting.shownRevealed, false);
});

test('a reload comes back to the same card, with the answers already given', async () => {
  const { sitting, Sitting } = await dealt();
  sitting.reveal(); await sitting.record(Rating.Good);
  sitting.reveal(); await sitting.record(Rating.Easy);

  const again = new Sitting();
  await again.start();
  assert.equal(again.resumed, true);
  assert.equal(again.i, 2);
  assert.equal(again.shown?.card.key, sitting.shown?.card.key);
  assert.equal(again.history.length, 2);
  assert.equal(again.done.answered, 2);
  assert.equal(again.lookBack(-1), 'back');
  assert.equal(again.shown?.card.key, 'jour|noun');
});

test('the last answer finishes the sitting and forgets it', async () => {
  const { app, sitting } = await dealt({ newPerDay: 2 });
  sitting.reveal(); await sitting.record(Rating.Good);
  sitting.reveal(); await sitting.record(Rating.Good);
  assert.equal(sitting.finished, true);
  assert.equal(sitting.shown, null);
  assert.equal(await app.session.savedSitting(), null);
  assert.equal(sitting.reveal(), false);
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
  assert.equal(sitting.shown?.card.rung, 'choose');
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
