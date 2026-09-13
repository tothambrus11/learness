/** A database written by an older version of the app opens in this one with
 *  nothing lost.
 *
 *  The upgrade code in db.ts had never been run by a test: it ran once on
 *  each device, when it ran, and a mistake in it is the one kind of bug
 *  that cannot be fixed by a second deploy — a card dropped on the way from
 *  version 1 to version 5 is a word's whole history gone. So each older
 *  shape is written here as that version wrote it, and the current code is
 *  asked to open it.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { State } from 'ts-fsrs';

/** The stores as version 1 made them, so a row can be put the way it was. */
async function atVersion(version: 1 | 3, seed: (d: Awaited<ReturnType<typeof openDB>>) => Promise<void>):
  Promise<void> {
  globalThis.indexedDB = new IDBFactory();
  const d = await openDB('frcog', version, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const cards = db.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('due', 'due');
        cards.createIndex('key', 'key');
        cards.createIndex('direction', 'direction');
        const reviews = db.createObjectStore('reviews', { keyPath: 'i', autoIncrement: true });
        reviews.createIndex('ts', 'ts');
        reviews.createIndex('card', 'id');
        db.createObjectStore('words', { keyPath: 'k' });
        db.createObjectStore('lessons', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('settings', { keyPath: 'name' });
        db.createObjectStore('meta', { keyPath: 'name' });
      }
      if (oldVersion < 2 && version >= 2) {
        const clips = db.createObjectStore('clips', { keyPath: 'id' });
        clips.createIndex('key', 'key');
      }
    },
  });
  await seed(d);
  d.close();
  /* The app's own db.ts, fresh, on the database just written. */
  vi.resetModules();
}

/** A card as version 1 stored it: keyed by direction, no channel or rung. */
const oldCard = (key: string, direction: string, over: Record<string, unknown> = {}): object => ({
  id: `${key}|${direction}`, key, direction,
  due: new Date('2026-03-01T08:00:00Z'), stability: 4, difficulty: 5, elapsed_days: 1,
  scheduled_days: 4, learning_steps: 0, reps: 3, lapses: 0, state: State.Review,
  last_review: new Date('2026-02-25T08:00:00Z'), ...over,
});

test('cards keyed by direction land on their rung, the lower one retires, and speaking cards go',
  async () => {
    await atVersion(1, async (d) => {
      await d.put('cards', oldCard('bug|noun', 'fr_en', { reps: 3 }));
      await d.put('cards', oldCard('bug|noun', 'en_fr', { reps: 5 }));
      await d.put('cards', oldCard('bug|noun', 'audio_en'));
      await d.put('cards', oldCard('bug|noun', 'speak'));
      await d.put('cards', oldCard('jour|noun', 'fr_en'));
      await d.add('reviews', { uid: 'r1', id: 'bug|noun|fr_en', key: 'bug|noun',
        direction: 'fr_en', ts: 1772000000, rating: 3, ms: 900, state: State.Review });
      await d.put('words', { k: 'natel|noun', fr: 'le natel', en: ['mobile phone'], pos: 'noun' });
      await d.put('settings', { name: 'maxNewPerDay', value: 7 });
    });
    const db = await import('../src/lib/db.js');
    const cards = await db.allCards();
    const ids = cards.map((c) => c.id).sort();
    assert.deepEqual(ids, ['bug|noun|heard|hear', 'bug|noun|written|recognise',
      'bug|noun|written|write', 'jour|noun|written|recognise'],
    'every card is on a rung, and the speaking card — graded by a recogniser that dropped the article — is gone');
    const bug = cards.filter((c) => c.key === 'bug|noun' && c.channel === 'written');
    assert.equal(bug.find((c) => c.rung === 'recognise')?.retired, true,
      'the lower rung retires under the higher');
    assert.equal(!!bug.find((c) => c.rung === 'write')?.retired, false, 'absent means not retired');
    assert.equal(bug.find((c) => c.rung === 'write')?.reps, 5, 'the scheduling state came along');
    assert.equal(cards.some((c) => 'direction' in c), false, 'and the direction is not carried');

    assert.equal((await db.allReviews()).length, 1, 'the log is untouched');
    assert.equal((await db.allReviews())[0]?.direction, 'fr_en', 'rows are history and keep their shape');
    assert.equal((await db.userWords())[0]?.fr, 'le natel');
    assert.equal((await db.getSettings()).maxNewPerDay, 7);
    assert.equal((await db.allClips()).length, 0, 'the clips store exists now, empty');
  });

test('the clips Kokoro made are dropped, and Supertonic’s are kept', async () => {
  await atVersion(3, async (d) => {
    await d.put('clips', { id: 'natel|noun|fr|kokoro', key: 'natel|noun', kind: 'fr',
      engine: 'kokoro', text: 'le natel', blob: new Blob(['a']) });
    await d.put('clips', { id: 'natel|noun|fr', key: 'natel|noun', kind: 'fr',
      text: 'le natel', blob: new Blob(['b']) });
    await d.put('clips', { id: 'natel|noun|fr|supertonic', key: 'natel|noun', kind: 'fr',
      engine: 'supertonic', text: 'le natel', blob: new Blob(['c']) });
    await d.put('settings', { name: 'kokoroReady', value: true });
    await d.put('settings', { name: 'supertonicReady', value: true });
    await d.put('cards', oldCard('natel|noun', 'en_fr'));
  });
  const db = await import('../src/lib/db.js');
  const clips = await db.allClips();
  assert.deepEqual(clips.map((c) => c.id), ['natel|noun|fr|supertonic'],
    'a clip with no engine at all is Kokoro’s too: it predates the id carrying a name');
  const settings = await db.getSettings();
  assert.equal('kokoroReady' in settings, false);
  assert.equal(settings.supertonicReady, true);
  assert.deepEqual((await db.allCards()).map((c) => c.id), ['natel|noun|written|write'],
    'and the card migration runs on this path as well');
});

test('a database at the current version opens without the upgrade touching it', async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const first = await import('../src/lib/db.js');
  await first.putCard({ ...oldCard('bug|noun', 'x'),
    id: 'bug|noun|written|write', key: 'bug|noun', channel: 'written', rung: 'write',
    retired: false } as Parameters<typeof first.putCard>[0]);
  (await first.db()).close();
  vi.resetModules();
  const again = await import('../src/lib/db.js');
  assert.deepEqual((await again.allCards()).map((c) => c.id), ['bug|noun|written|write']);
});
