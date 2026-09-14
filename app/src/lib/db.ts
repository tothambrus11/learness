/** Local storage for everything the learner owns.
 *
 *  IndexedDB rather than localStorage: the review log is append-only and kept
 *  forever, both because it is the record of what you actually did and because
 *  FSRS can later retune its own parameters from it. That outgrows a 5 MB
 *  string store.
 */
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { legacyToChannel, settleRungs } from './ladder.js';
import type { CardId, WordKey } from './keys.js';
import type { Clip, Lesson, Review, Settings, StoredCard, UserWord } from './model.js';
import { looksLikeMillis, nowSec, secOf, whenMs } from './units.js';
import type { Millis, Seconds } from './units.js';

const NAME = 'frcog';
const VERSION = 5;

/** A row of the two name/value stores. */
interface NamedValue { name: string; value: unknown }

/** What is in the database, so a typo in a store name or a wrong shape in a
 *  `put` is a compile error rather than a row nobody can read back. */
interface Learness extends DBSchema {
  cards: {
    key: CardId;
    value: StoredCard;
    indexes: { due: string; key: WordKey; direction: string };
  };
  reviews: {
    key: number;
    value: Review;
    indexes: { ts: Seconds; card: CardId };
  };
  words: { key: WordKey; value: UserWord };
  lessons: { key: number; value: Lesson };
  settings: { key: string; value: NamedValue };
  meta: { key: string; value: NamedValue };
  clips: { key: string; value: Clip; indexes: { key: string } };
}

export const DEFAULT_SETTINGS: Settings = {
  targetReviews: 120,       // the real budget: how much work per day you want
  maxNewPerDay: 20,         // ceiling, even on an empty day
  desiredRetention: 0.9,    // FSRS dial: how much you are willing to forget
  refresherShare: 0.08,     // slice of each session spent on old, not-yet-due words
  costPerNewWord: 2.5,      // same-day reviews one new word generates
  leechThreshold: 6,        // lapses before a card is flagged and reset
  sessionLimit: 60,         // cards offered in one sitting
  autoSync: 'always',       // off | unmetered | always. ~30 kB, so not worth gating
  autoSyncMinutes: 15,      // never sync automatically more often than this
  bulkDownload: 'unmetered',// off | unmetered | always. Audio is megabytes, so this is gated
  bulkConsent: false,       // "yes, download on this connection", remembered per device
};

let dbPromise: Promise<IDBPDatabase<Learness>> | null = null;
let instance: IDBPDatabase<Learness> | null = null;

/** The database, opened once.
 *
 *  Opening at a newer version than another tab still holds open waits for
 *  that tab — silently, for ever, on a page that says "Loading…". So a blocked
 *  open is reported as an error instead, naming the cause, and an older tab
 *  that is told a newer one wants in lets go and reloads onto the new version.
 *  Should the other tab close later, the open completes and the next call
 *  gets the database.
 */
export function db(): Promise<IDBPDatabase<Learness>> {
  if (!dbPromise) {
    let rejectBlocked: (err: Error) => void = () => {};
    const blocked = new Promise<never>((_, reject) => { rejectBlocked = reject; });
    const open = openDB<Learness>(NAME, VERSION, {
      blocked() {
        rejectBlocked(new Error('This app is open in another tab or window on an older '
          + 'version, which has to close before this one can start. Close it, then reload.'));
      },
      blocking() {
        /* Another tab is upgrading: let go of the database, then reload so
           this tab runs the new version too. */
        instance?.close();
        instance = null;
        dbPromise = null;
        if (typeof location !== 'undefined') location.reload();
      },
      terminated() {
        instance = null;
        dbPromise = null;
      },
      async upgrade(d, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const cards = d.createObjectStore('cards', { keyPath: 'id' });
          cards.createIndex('due', 'due');
          cards.createIndex('key', 'key');
          cards.createIndex('direction', 'direction');

          const reviews = d.createObjectStore('reviews', { keyPath: 'i', autoIncrement: true });
          reviews.createIndex('ts', 'ts');
          reviews.createIndex('card', 'id');

          d.createObjectStore('words', { keyPath: 'k' });          // added by hand
          d.createObjectStore('lessons', { keyPath: 'id', autoIncrement: true });
          d.createObjectStore('settings', { keyPath: 'name' });
          d.createObjectStore('meta', { keyPath: 'name' });
        }
        if (oldVersion < 2) {
          /* Audio made on this device for words the catalogue lacks. Not
             synced: each device makes its own, the model being local. */
          const clips = d.createObjectStore('clips', { keyPath: 'id' });
          clips.createIndex('key', 'key');
        }
        if (oldVersion >= 2 && oldVersion < 4) {
          /* The voice that made a clip is now part of its id, and Kokoro is no
             longer that voice. Its clips go: they cannot be renamed into
             Supertonic's, and the words screen offers to make the missing ones
             again. Clips with no engine at all are Kokoro's too — they predate
             the id carrying a name. */
          const clips = tx.objectStore('clips');
          for (let cur = await clips.openCursor(); cur; cur = await cur.continue()) {
            if (cur.value.engine !== 'supertonic') await clips.delete(cur.value.id);
          }
          const settings = tx.objectStore('settings');
          for (const name of ['kokoroReady', 'kokoroLoadMs', 'kokoroBackend']) {
            await settings.delete(name);
          }
        }
        if (oldVersion >= 1 && oldVersion < 5) {
          /* Five directions become two channels of rungs. Each old card lands
             on the rung its direction implies, keeping its scheduling state;
             where a word had both a reading and a writing card, the lower rung
             retires. Speaking cards go — they were graded by a recogniser that
             dropped the article — and their reviews stay in the log. The same
             mapper runs on cards that later arrive by sync, so a device that
             has not migrated cannot undo this one. */
          const cards = tx.objectStore('cards');
          const old = await cards.getAll();
          const byId = new Map();
          for (const c of old) {
            const m = legacyToChannel(c);
            if (m) byId.set(m.id, m);
          }
          /* Issued together, not awaited one by one: the upgrade transaction
             finishes when the last request does, and a pause between requests
             is a chance for a slower engine to call it finished early. */
          void cards.clear();
          for (const c of settleRungs<StoredCard>([...byId.values()])) void cards.put(c);
        }
      },
    });
    void open.then((d) => { instance = d; }, () => {});
    dbPromise = Promise.race([open, blocked]);
    /* Blocked now is not blocked for ever: once the other tab closes, the
       open completes, and the next call should have it. */
    dbPromise.catch(() => { void open.then(() => { dbPromise = open; }, () => {}); });
  }
  return dbPromise;
}

/** Every dial, with whatever this device has stored laid over the defaults.
 *
 *  The store is name/value rows, so what comes back is `unknown` and is
 *  trusted here — this is the one boundary where a stored value becomes a
 *  typed one. A row nobody writes any more simply has no field to land in and
 *  is carried along harmlessly. */
export async function getSettings(): Promise<Settings> {
  const d = await db();
  const rows = await d.getAll('settings');
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) Object.assign(out, { [r.name]: r.value });
  return out;
}

export async function setSetting<K extends keyof Settings>(
  name: K, value: Settings[K],
): Promise<void> {
  const d = await db();
  await d.put('settings', { name, value });
}

export const getCard = async (id: CardId): Promise<StoredCard | undefined> =>
  (await db()).get('cards', id);
export const putCard = async (card: StoredCard): Promise<CardId> => (await db()).put('cards', card);
export const allCards = async (): Promise<StoredCard[]> => (await db()).getAll('cards');
/** Every rung of one word, on either channel. */
export const cardsFor = async (key: WordKey): Promise<StoredCard[]> =>
  (await db()).getAllFromIndex('cards', 'key', key);

export async function logReview(entry: Review): Promise<void> {
  const d = await db();
  await d.add('reviews', entry);
}

export const allReviews = async (): Promise<Review[]> => (await db()).getAll('reviews');

/** Reviews since a cutoff, given as a millisecond instant like `Date.now()`.
 *
 *  The log stores seconds — that is the shape the sync speaks — and the
 *  conversion belongs here rather than at each call site. Both callers passed
 *  `Date.now() - WEEK` straight into an index of seconds, which is a cutoff
 *  some fifty-six thousand years out: the range matched nothing, every screen
 *  read the week as empty, and so recall was always "—", today's count always
 *  zero, and the retention throttle never once fired.
 */
export async function reviewsSince(at: Millis): Promise<Review[]> {
  /* The type says milliseconds; this says so at runtime too, for the one
     caller that might arrive from untyped code or a hand-built number. A
     cutoff in the wrong unit is not an error anywhere else — it is simply an
     empty result, which is what made the original bug invisible. */
  if (!looksLikeMillis(at)) {
    throw new Error(`reviewsSince wants a moment in milliseconds, got ${at}`);
  }
  const d = await db();
  return d.getAllFromIndex('reviews', 'ts', IDBKeyRange.lowerBound(secOf(at)));
}

export const userWords = async (): Promise<UserWord[]> => (await db()).getAll('words');

/* Clips are keyed "<word key>|<fr or en>|<voice>". The voice is in the id so
   that changing it does not mean guessing which model made what. */
export const clipId = (key: string, kind: Clip['kind'], engine: string): string =>
  `${key}|${kind}|${engine}`;
export const getClip = async (id: string): Promise<Clip | undefined> =>
  (await db()).get('clips', id);
export const allClips = async (): Promise<Clip[]> => (await db()).getAll('clips');
export const putClip = async (clip: Clip): Promise<string> => (await db()).put('clips', clip);
export const clipsFor = async (key: string): Promise<Clip[]> =>
  (await db()).getAllFromIndex('clips', 'key', key);
export async function deleteClipsFor(key: string): Promise<void> {
  const d = await db();
  for (const c of await d.getAllFromIndex('clips', 'key', key)) await d.delete('clips', c.id);
}
/* There is no delete: a word is removed by a tombstone (words.ts), so that
   the removal travels to the other devices instead of being resurrected. */
/** Store one of your words.
 *
 *  Copied on the way in, fields and arrays both. A screen hands over what it
 *  is holding, and what a Svelte screen holds is a reactive proxy —
 *  IndexedDB's structured clone cannot copy one, and says so with
 *  `DataCloneError: [object Array] could not be cloned`, which reaches the
 *  learner as an Add button that does nothing. The word is plain data, so a
 *  plain copy of it is the whole fix, and it belongs here rather than in every
 *  screen that ever calls this. */
export const putUserWord = async (w: UserWord): Promise<WordKey> =>
  (await db()).put('words', { ...w, en: [...w.en] });

/* The sitting in progress, so a reload deals the same card. Device-local and
   disposable: it is a position in a queue, not something learned, and it is
   rebuilt from the cards whenever it does not apply. */
export async function getMeta<T>(name: string): Promise<T | null> {
  return (await db()).get('meta', name).then((row) => (row?.value ?? null) as T | null);
}
export const setMeta = async (name: string, value: unknown): Promise<string> =>
  (await db()).put('meta', { name, value });
export const clearMeta = async (name: string): Promise<void> => (await db()).delete('meta', name);

export const lessons = async (): Promise<Lesson[]> => (await db()).getAll('lessons');
export const addLesson = async (lesson: Lesson): Promise<number> =>
  (await db()).add('lessons', lesson);

/** Everything this device knows, in the shape the pipeline imports. */
export async function exportProgress(): Promise<{
  exported: Seconds;
  states: unknown[];
  reviews: unknown[];
  words: UserWord[];
  lessons: Lesson[];
}> {
  const d = await db();
  const [cards, reviews, words, lessonRows] = await Promise.all([
    d.getAll('cards'), d.getAll('reviews'), d.getAll('words'), d.getAll('lessons'),
  ]);
  return {
    exported: nowSec(),
    states: cards.map((c) => ({
      key: c.key, direction: c.direction ?? `${c.channel}/${c.rung}`, reps: c.reps,
      lapses: c.lapses, ivl: c.scheduled_days, ease: c.difficulty,
      due: secOf(whenMs(c.due)), retired: !!c.retired,
    })),
    reviews: reviews.map((r) => ({
      key: r.key, direction: r.direction, ts: r.ts, rating: r.rating, ms: r.ms,
    })),
    words, lessons: lessonRows,
  };
}
