import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Rating, State } from 'ts-fsrs';
import { agoMs, DAY_MS, nowMs, secOf, trustMs, WEEK_MS } from '../src/lib/units.js';
import { freshApp, smallCatalogue } from './harness.js';
import type { App } from './harness.js';

/** Answer every card of a sitting Good, as a diligent afternoon would. */
async function answerAll(app: App, limit = 100): Promise<number> {
  const built = await app.session.buildSession();
  let n = 0;
  for (const item of built.items.slice(0, limit)) {
    await app.session.answer(item.card, item.word, Rating.Good, built.settings, 1000);
    n += 1;
  }
  await app.session.forgetSitting();
  return n;
}

test('a fresh session deals the easiest words that have not been started', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(6) });
  await app.db.setSetting('maxNewPerDay', 3);
  const built = await app.session.buildSession();
  assert.equal(built.items.length, 3, 'the day says three');
  assert.deepEqual(built.items.map((it) => it.card.key), ['temps|noun', 'jour|noun', 'monde|noun'],
    'from the front of the ranking, which is where the cheapest words are');
  assert.equal(built.allowance, 3);
  assert.equal(built.introducedToday, 0);
});

test('the day’s new words are spent once, not once per sitting', async () => {
  /* The bug: nothing told the allowance what the day had already met, so every
     new sitting dealt another maxNewPerDay from the front of a catalogue
     ranked easiest-first — which is what "I keep getting words that are too
     easy" is, from the inside. */
  const app = await freshApp({ catalogue: smallCatalogue(12) });
  await app.db.setSetting('maxNewPerDay', 3);

  const first = await answerAll(app);
  assert.equal(first, 3);

  const second = await app.session.buildSession();
  assert.equal(second.introducedToday, 3, 'the log says three met today');
  assert.equal(second.allowance, 0, 'so there is nothing left to introduce');
  assert.equal(second.items.every((it) => it.card.reps > 0), true,
    'what is left of the day is the words already met, coming back');
});

test('tomorrow the allowance is whole again', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(12) });
  await app.db.setSetting('maxNewPerDay', 2);
  await answerAll(app);

  /* Yesterday's answers, moved back a day in the log. */
  const rows = await app.db.allReviews();
  const d = await app.db.db();
  for (const r of rows) {
    await d.put('reviews', { ...r, ts: secOf(trustMs(nowMs() - DAY_MS)) });
  }
  const today = await app.session.buildSession({ resume: false });
  assert.equal(today.introducedToday, 0);
  assert.equal(today.allowance, 2);
});

test('an answer writes the card, and writes down what only the moment knows',
  async () => {
    const app = await freshApp({ catalogue: smallCatalogue(3) });
    const built = await app.session.buildSession();
    const [item] = built.items;
    assert.ok(item);

    const result = await app.session.answer(item.card, item.word, Rating.Good,
      built.settings, 2500);
    const stored = await app.db.getCard(item.card.id);
    assert.equal(stored?.reps, 1, 'the card moved');
    assert.ok((stored?.updatedAt ?? 0) > 0, 'and says when, for the sync to merge on');

    const [logged] = await app.db.allReviews();
    assert.ok(logged);
    assert.equal(logged.key, item.card.key);
    assert.equal(logged.rating, Rating.Good);
    assert.equal(logged.ms, 2500);
    assert.equal(logged.state, State.New, 'what was being tested, not what it became');
    assert.equal(logged.met, true, 'the word had never been answered on any rung');
    assert.equal(logged.learned, false);
    assert.equal(result.justLearned, false);
  });

test('the same word answered again is not met again', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const built = await app.session.buildSession();
  const [item] = built.items;
  assert.ok(item);
  await app.session.answer(item.card, item.word, Rating.Again, built.settings, 1000);
  const back = await app.db.getCard(item.card.id);
  assert.ok(back);
  await app.session.answer({ ...back, channel: 'written', rung: item.card.rung },
    item.word, Rating.Good, built.settings, 1000);

  const met = (await app.db.allReviews()).map((r) => r.met);
  assert.deepEqual(met, [true, false], 'met once, however many answers it took');
  assert.equal(app.progress.metOn(await app.db.allReviews()).length, 1);
});

test('a rung opened on a word known for weeks is not a word met today', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const cards = await app.db.allCards();
  assert.equal(cards.length, 0);

  /* A word answered a fortnight ago, and a second rung of it opened today. */
  const old = trustMs(nowMs() - 14 * DAY_MS);
  const { card } = await import('./make.js');
  await app.db.putCard(card('temps|noun', 'written', 'recognise',
    { reps: 6, state: State.Review, stability: 40, last_review: new Date(old) }));
  const fresh = card('temps|noun', 'heard', 'hear');
  await app.db.putCard(fresh);
  /* Logged the way a row written before `met` existed looks: no flag at all. */
  const d = await app.db.db();
  const { uid, met: _met, ...row } = (await import('./make.js')).review(
    { key: 'temps|noun', id: fresh.id, state: State.New, ts: secOf(nowMs()) });
  await d.add('reviews', { ...row, uid });

  const recent = await app.db.reviewsSince(agoMs(WEEK_MS));
  const seenBefore = app.progress.keysAnsweredBefore(await app.db.allCards(),
    app.progress.dayStart());
  assert.deepEqual(app.progress.metOn(recent, { seenBefore }), [],
    'the word has a card answered before today, so today did not meet it');
  assert.deepEqual(app.progress.metOn(recent), ['temps|noun'],
    'without the cards, a week of log cannot tell: hence the argument');
});

test('a sitting is written down and picked up where it was left', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(6) });
  await app.db.setSetting('maxNewPerDay', 4);
  const built = await app.session.buildSession();
  const [first] = built.items;
  assert.ok(first);
  await app.session.answer(first.card, first.word, Rating.Good, built.settings, 100);
  await app.session.rememberSitting({ items: built.items, i: 1,
    done: { answered: 1, right: 1 }, history: [] });

  const again = await app.session.buildSession();
  assert.ok(again.resumed, 'the same queue');
  assert.equal(again.resumed?.i, 1, 'at the card it was left on');
  assert.deepEqual(again.items.map((it) => it.card.id), built.items.map((it) => it.card.id));
  assert.equal(again.items[0]?.card.reps, 1, 'and the cards are re-read, not remembered');
});

test('one sitting serves every rung, the typed ones included', async () => {
  /* There used to be a second kind — a "walk" that dropped the three typed
     rungs — and with it a second queue, a second resume rule and a second set
     of copy, for no exercise this one did not already have. */
  const app = await freshApp({ catalogue: smallCatalogue(6) });
  await app.db.setSetting('maxNewPerDay', 0);
  const { card } = await import('./make.js');
  /* A word that has climbed to "write it", and is due. */
  await app.db.putCard(card('temps|noun', 'written', 'write',
    { reps: 8, state: State.Review, stability: 10, due: new Date(nowMs() - DAY_MS) }));

  const built = await app.session.buildSession();
  assert.deepEqual(built.items.map((it) => it.card.rung), ['write'],
    'the card that is due is dealt, whatever it asks for');
});
