import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Rating, State } from 'ts-fsrs';
import { agoMs, DAY_MS, MINUTE_MS, nowMs, secOf, trustMs, WEEK_MS } from '../src/lib/units.js';
import { freshApp, smallCatalogue } from './harness.js';
import { ms, sent } from './make.js';
import type { App } from './harness.js';

/** Answer every card of a sitting Good, as a diligent afternoon would. */
async function answerAll(app: App, limit = 100): Promise<number> {
  const built = await app.session.buildSession();
  let n = 0;
  for (const item of built.items.slice(0, limit)) {
    await app.session.answer(item.card, item.word, Rating.Good, built.settings, 1000);
    n += 1;
  }
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
  assert.equal(second.waiting.length, 3, 'on their ten-minute step, and said to be');
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
  const today = await app.session.buildSession();
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

test('an answered card is not dealt again when the sitting is opened again', async () => {
  /* The queue used to be written down and picked up at a position. Now it is
     dealt again: the same cards in the same order, minus the one answered —
     which is no longer new, and is on a learning step ten minutes off. */
  const app = await freshApp({ catalogue: smallCatalogue(6) });
  await app.db.setSetting('maxNewPerDay', 4);
  const built = await app.session.buildSession();
  const ids = built.items.map((it) => it.card.id);
  const [first] = built.items;
  assert.ok(first);
  await app.session.answer(first.card, first.word, Rating.Good, built.settings, 100);

  const again = await app.session.buildSession();
  assert.deepEqual(again.items.map((it) => it.card.id), ids.slice(1), 'the rest, in the same order');
  assert.deepEqual(again.waiting.map((it) => it.card.id), [first.card.id],
    'the answered one comes back later than the sitting is long');
  assert.equal(again.waiting[0]?.card.reps, 1, 'and the card is re-read, not remembered');
  const everywhere = [...again.items, ...again.waiting].map((it) => it.card.id);
  assert.equal(new Set(everywhere).size, everywhere.length, 'no card twice');
});

test('a learning card due in a few minutes is dealt where the pace says it falls', async () => {
  const catalogue = smallCatalogue(12);
  const keys = catalogue.index.map((e) => e.k);
  const app = await freshApp({ catalogue });
  await app.db.setSetting('maxNewPerDay', 0);
  const { card } = await import('./make.js');
  /* Ten due since yesterday, and one on a learning step two minutes off. */
  for (const key of keys.slice(0, 10)) {
    await app.db.putCard(card(key, 'written', 'recognise', {
      reps: 3, state: State.Review, stability: 5,
      due: new Date(nowMs() - DAY_MS), last_review: new Date(nowMs() - 6 * DAY_MS),
    }));
  }
  await app.db.putCard(card(keys[10]!, 'written', 'recognise', {
    reps: 1, state: State.Learning, stability: 1,
    due: new Date(nowMs() + 2 * MINUTE_MS), last_review: new Date(nowMs() - MINUTE_MS),
  }));

  const built = await app.session.buildSession();
  assert.equal(built.items.length, 11);
  /* Two minutes at 25 s a card is five cards away: dealt after four others. */
  assert.equal(built.items[4]?.card.key, keys[10]);
  assert.equal(built.waiting.length, 0);
});

test('a learning card that comes back later than the sitting is long waits, and the sitting says when',
  async () => {
    const catalogue = smallCatalogue(3);
    const app = await freshApp({ catalogue });
    await app.db.setSetting('maxNewPerDay', 0);
    const { card } = await import('./make.js');
    const key = catalogue.index[0]!.k;
    await app.db.putCard(card(key, 'written', 'recognise', {
      reps: 1, state: State.Learning, stability: 1,
      due: new Date(nowMs() + 8 * MINUTE_MS), last_review: new Date(nowMs() - 2 * MINUTE_MS),
    }));
    const built = await app.session.buildSession();
    assert.deepEqual(built.items, []);
    assert.deepEqual(built.waiting.map((it) => it.card.key), [key]);
    assert.equal(built.dueCount, 1, 'it is owed today, even so');
  });

test('the same open twice deals the same cards', async () => {
  const catalogue = smallCatalogue(12);
  const app = await freshApp({ catalogue });
  await app.db.setSetting('maxNewPerDay', 4);
  const { card } = await import('./make.js');
  for (const [i, e] of catalogue.index.slice(0, 6).entries()) {
    await app.db.putCard(card(e.k, 'written', 'recognise', {
      reps: 3, state: State.Review, stability: 2 + i * 2,
      due: new Date(nowMs() - DAY_MS), last_review: new Date(nowMs() - 8 * DAY_MS),
    }));
  }
  const once = await app.session.buildSession();
  const again = await app.session.buildSession();
  assert.ok(once.items.length >= 6);
  assert.deepEqual(again.items.map((it) => it.card.id), once.items.map((it) => it.card.id));
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

test('a function word enters on the sense channel and brings its own file', async () => {
  /* The index carries "sur|prep" at level 0, whose records live in
     function.json rather than a level file, and the card it is dealt on is
     the meeting, not "read FR → EN". */
  const { entry, word } = await import('./make.js');
  const small = smallCatalogue(2);
  const sur = word({ k: 'sur|prep', fr: 'sur', answer: 'sur', lemma: 'sur', pos: 'prep', en: ['on'],
    lvl: 0, kind: 'function', sense: 'on a surface', contrast: [],
    ex: [{ fr: 'Le livre est sur la table.', en: 'The book is on the table.', f: 'sur' }] });
  const catalogue = {
    index: [small.index[0]!, entry({ k: 'sur|prep', fr: 'sur', en: ['on'], lvl: 0, m: 0, kind: 'function' }),
      small.index[1]!],
    words: small.words,
    functionWords: [sur],
  };
  const app = await freshApp({ catalogue });
  await app.db.setSetting('maxNewPerDay', 3);
  const built = await app.session.buildSession();
  const cards = built.items.map((it) => [it.card.key, it.card.channel, it.card.rung]);
  assert.deepEqual(cards.find((c) => c[0] === 'sur|prep'), ['sur|prep', 'sense', 'meet']);
  assert.ok(app.fetched.some((u) => u.endsWith('/catalogue/function.json')), 'level 0 was fetched');
  const item = built.items.find((it) => it.card.key === 'sur|prep');
  assert.equal(item?.word.sense, 'on a surface', 'and the record came from it');
});

test('a word added on the words screen is the next card of the sitting', async () => {
  /* It used to wait for the next fresh sitting — the queue was written down
     and a word added mid-way had no place in it. The queue is derived on
     every open now, and a new word of your own takes the first place. */
  const app = await freshApp({ catalogue: smallCatalogue(6) });
  await app.db.setSetting('maxNewPerDay', 3);
  const built = await app.session.buildSession();
  const [first] = built.items;
  assert.ok(first);
  await app.session.answer(first.card, first.word, Rating.Good, built.settings, 100);
  await app.words.addWord({ fr: 'natel', en: ['mobile phone'], pos: 'noun', gender: 'm' });

  const again = await app.session.buildSession();
  assert.equal(again.items[0]?.card.key, 'natel|noun');
  assert.ok(again.items[0]?.card.lesson, 'yours, which is what puts it first');
  assert.equal(again.items.length, 3, 'and the catalogue fills what the day still allows');
});

test('your own words are dealt in the order you added them, ahead of the catalogue', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(6) });
  await app.db.setSetting('maxNewPerDay', 1);
  const { userWord } = await import('./make.js');
  const d = await app.db.db();
  /* Two of your own, the second added a moment after the first — and put
     into the store the way a sync would, so the cards are made on opening. */
  await d.put('words', userWord({ k: 'natel|noun', fr: 'le natel', en: ['mobile phone'],
    addedAt: trustMs(nowMs() - 2000), updatedAt: trustMs(nowMs() - 2000) }));
  await d.put('words', userWord({ k: 'bof|intj', fr: 'bof', en: ['meh'], pos: 'intj',
    addedAt: trustMs(nowMs() - 1000), updatedAt: trustMs(nowMs() - 1000) }));

  const built = await app.session.buildSession();
  assert.deepEqual(built.items.map((it) => it.card.key), ['natel|noun', 'bof|intj', 'temps|noun']);
});

test('your own due words are never cut, the catalogue’s are', async () => {
  const catalogue = smallCatalogue(12);
  const app = await freshApp({ catalogue });
  await app.db.setSetting('maxNewPerDay', 0);
  await app.db.setSetting('sessionLimit', 10);
  const { card, userWord } = await import('./make.js');
  const d = await app.db.db();
  const yesterday = new Date(nowMs() - DAY_MS);
  /* Eleven catalogue words due, and one of your own that is the best
     remembered of the lot — last in the order, and still dealt. */
  for (const [i, e] of catalogue.index.slice(0, 11).entries()) {
    await app.db.putCard(card(e.k, 'written', 'recognise', {
      reps: 3, state: State.Review, stability: 3 + i, due: yesterday,
      last_review: new Date(nowMs() - 10 * DAY_MS),
    }));
  }
  await d.put('words', userWord({ k: 'natel|noun', fr: 'le natel', en: ['mobile phone'] }));
  await app.db.putCard(card('natel|noun', 'written', 'recognise', {
    reps: 6, state: State.Review, stability: 60, due: yesterday, lesson: true,
    last_review: new Date(nowMs() - 2 * DAY_MS),
  }));

  const built = await app.session.buildSession();
  const keys: string[] = built.items.map((it) => it.card.key);
  assert.ok(keys.includes('natel|noun'), 'yours is in');
  assert.equal(keys.filter((k) => k !== 'natel|noun').length, 9, 'two of the catalogue’s are not');
});

test('when today’s minutes are spent, due cards still come and new ones do not', async () => {
  const catalogue = smallCatalogue(6);
  const app = await freshApp({ catalogue });
  await app.db.setSetting('minutesByWeekday', [1, 1, 1, 1, 1, 1, 1]);
  await app.db.setSetting('maxNewPerDay', 3);
  const { card, review } = await import('./make.js');
  const key = catalogue.index[5]!.k;
  await app.db.putCard(card(key, 'written', 'recognise', {
    reps: 3, state: State.Review, stability: 4,
    due: new Date(nowMs() - DAY_MS), last_review: new Date(nowMs() - 5 * DAY_MS),
  }));
  /* A minute and a half of answering already today, against a minute planned. */
  for (let i = 0; i < 3; i++) {
    await app.db.logReview(review({ key, state: State.Review, ts: secOf(nowMs()), ms: 30_000 }));
  }
  const built = await app.session.buildSession();
  assert.equal(built.plan.spent, true);
  assert.equal(built.allowance, 0, 'no new words past the plan');
  assert.deepEqual(built.items.map((it) => it.card.key), [key], 'what is due is still dealt');
});

test('a word that arrives from the server on opening is dealt first', async () => {
  /* Added through Claude a moment ago on the other phone: it is in this
     sitting, not the one after the next visit home. */
  const app = await freshApp({ catalogue: smallCatalogue(6) });
  await app.db.setSetting('maxNewPerDay', 2);
  const sync = await import('../src/lib/sync.js');
  await sync.configureSync({ api: 'https://example.test', token: 'a-token' });
  const { userWord } = await import('./make.js');
  const calls: unknown[] = [];
  const fetchImpl: typeof fetch = async (_url, init): Promise<Response> => {
    calls.push(sent(init?.body));
    return new Response(JSON.stringify({
      pull: { words: [userWord({ k: 'natel|noun', fr: 'le natel', en: ['mobile phone'],
        updatedAt: ms(900) })] },
      cursor: 1,
    }), { headers: { 'content-type': 'application/json' } });
  };

  const built = await app.session.buildSession({ pull: { fetchImpl } });
  assert.equal(calls.length, 1, 'one pull, before dealing');
  assert.equal(built.items[0]?.card.key, 'natel|noun');
  assert.equal(built.items.length, 3, 'and the catalogue after it');
});

test('a server that does not answer does not hold the sitting up', async () => {
  const app = await freshApp({ catalogue: smallCatalogue(3) });
  const sync = await import('../src/lib/sync.js');
  await sync.configureSync({ api: 'https://example.test', token: 'a-token' });
  const never: typeof fetch = () => new Promise<Response>(() => {});
  const built = await app.session.buildSession({ pull: { fetchImpl: never, timeoutMs: 20 } });
  assert.ok(built.items.length > 0, 'dealt from what is here');
});
