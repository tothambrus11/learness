/** Local storage for everything the learner owns: cards, the review log, the
 *  words added by hand, and the audio made on this device. */

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';

import { DEFAULT_DISPLAY } from './gender';
import { legacyToChannel, settleRungs } from './ladder';
import type { LegacyCard } from './ladder';
import type {
  Card,
  CardId,
  Clip,
  Lesson,
  Review,
  Settings,
  SittingSnapshot,
  UserWord,
  WordKey,
} from './types';

/** The database's name. One per origin; the app owns its origin. */
const NAME = 'frcog';

/** The schema version. Raising it runs `upgrade()` from whatever the device
 *  had, so every step below must stay in place forever. */
const VERSION = 5;

/** One row of the settings store: a name and whatever was written under it. */
interface SettingRow {
  /** The setting's name, and the store's key. */
  name: string;
  /** Its value. Typed loosely because the store holds every kind. */
  value: unknown;
}

/** What the meta store may hold, by name. Unlike settings, these are
 *  device-local scratch rather than preferences. */
interface MetaValues {
  /** The sitting in progress, so a reload deals the same card. */
  sitting: SittingSnapshot;
}

/** One row of the meta store. */
interface MetaRow {
  /** Which piece of scratch this is, and the store's key. */
  name: string;
  /** Its value. */
  value: MetaValues[keyof MetaValues];
}

/** Every store, its key type, its value type and its indexes, declared for
 *  `idb` so that a typo in a name is a compile error. */
interface LearnessDB extends DBSchema {
  /** One scheduled card per word per rung. */
  cards: {
    key: CardId;
    value: Card;
    indexes: {
      /** When the card next comes round. */
      due: Date;
      /** Which word it is a rung of, for reading one word's whole ladder. */
      key: WordKey;
      /** The pre-ladder direction. Present on every device that was upgraded
       *  rather than created fresh, so it stays declared. */
      direction: string;
    };
  };
  /** The append-only review log. */
  reviews: {
    key: number;
    value: Review;
    indexes: {
      /** Unix seconds of the answer, for reading a day or a week. */
      ts: number;
      /** The card answered. */
      card: CardId;
    };
  };
  /** Words the learner added by hand. */
  words: { key: WordKey; value: UserWord };
  /** Pasted lessons, for grouping the words that arrived together. */
  lessons: { key: number; value: Lesson };
  /** Preferences and anything else written by name. */
  settings: { key: string; value: SettingRow };
  /** Device-local scratch, such as the sitting in progress. */
  meta: { key: string; value: MetaRow };
  /** Audio made on this device. Never synced. */
  clips: {
    key: string;
    value: Clip;
    indexes: {
      /** The word the clip is about. */
      key: string;
    };
  };
}

/** Everything a fresh device starts with. Every key of `Settings` is present,
 *  so `getSettings()` can promise a complete record and no caller has to guard
 *  a missing preference. The display dials come from gender.ts. */
export const DEFAULT_SETTINGS: Settings = {
  targetReviews: 120, // the real budget: how much work per day you want
  maxNewPerDay: 20, // ceiling, even on an empty day
  desiredRetention: 0.9, // FSRS dial: how much you are willing to forget
  refresherShare: 0.08, // slice of each session spent on old, not-yet-due words
  costPerNewWord: 2.5, // same-day reviews one new word generates
  leechThreshold: 6, // lapses before a card is flagged and reset
  sessionLimit: 60, // cards offered in one sitting
  autoSync: 'always', // off | unmetered | always. ~30 kB, so not worth gating
  autoSyncMinutes: 15, // never sync automatically more often than this
  bulkDownload: 'unmetered', // off | unmetered | always. Audio is megabytes, so this is gated
  bulkConsent: false, // "yes, download on this connection", remembered per device
  ...DEFAULT_DISPLAY,
  syncApi: '', // empty means the origin the app is served from
  syncToken: '', // empty means not signed in
  syncCursor: 0, // the server sequence this device has everything up to
  syncedAt: 0, // milliseconds at the last successful sync
  syncEmail: '',
  supertonicReady: false, // the on-device voice has not been fetched
  supertonicLoadMs: null,
  supertonicBackend: null,
};

/** The open request, so every caller joins the same one. */
let dbPromise: Promise<IDBPDatabase<LearnessDB>> | null = null;

/** The open database, kept so that a tab told to let go can close it. */
let instance: IDBPDatabase<LearnessDB> | null = null;

/** The version-change transaction a migration step runs inside. */
type UpgradeTx = IDBPTransaction<LearnessDB, StoreNames<LearnessDB>[], 'versionchange'>;

/** Version 1: the stores the app has always had, and the indexes they are read
 *  by. */
function createStores(d: IDBPDatabase<LearnessDB>): void {
  const cards = d.createObjectStore('cards', { keyPath: 'id' });
  cards.createIndex('due', 'due');
  cards.createIndex('key', 'key');
  cards.createIndex('direction', 'direction');

  const reviews = d.createObjectStore('reviews', { keyPath: 'i', autoIncrement: true });
  reviews.createIndex('ts', 'ts');
  reviews.createIndex('card', 'id');

  d.createObjectStore('words', { keyPath: 'k' }); // added by hand
  d.createObjectStore('lessons', { keyPath: 'id', autoIncrement: true });
  d.createObjectStore('settings', { keyPath: 'name' });
  d.createObjectStore('meta', { keyPath: 'name' });
}

/** Version 2: the store for audio made on this device, indexed by word. */
function createClipStore(d: IDBPDatabase<LearnessDB>): void {
  const clips = d.createObjectStore('clips', { keyPath: 'id' });
  clips.createIndex('key', 'key');
}

/** Version 4: only the clips of the current voice survive. The voice that made
 *  a clip is part of its id, so a clip from an earlier one — or from before the
 *  id carried a name at all — cannot be renamed and goes, along with the
 *  settings that voice wrote. */
async function dropOtherVoices(tx: UpgradeTx): Promise<void> {
  const clips = tx.objectStore('clips');
  for (let cur = await clips.openCursor(); cur; cur = await cur.continue()) {
    if (cur.value.engine !== 'supertonic') await clips.delete(cur.value.id);
  }
  const settings = tx.objectStore('settings');
  for (const name of ['kokoroReady', 'kokoroLoadMs', 'kokoroBackend']) {
    await settings.delete(name);
  }
}

/** Version 5: five directions become two channels of rungs. Each old card
 *  lands on the rung its direction implies, keeping its scheduling state;
 *  where a word had both a reading and a writing card, the lower rung retires.
 *  Speaking cards go, their reviews staying in the log. */
async function migrateToRungs(tx: UpgradeTx): Promise<void> {
  const cards = tx.objectStore('cards');
  /* Rows written before version 5 carry `direction` and no rung, which the
     store's own type no longer admits. */
  const old = (await cards.getAll()) as unknown as LegacyCard[];
  const byId = new Map<CardId, Card>();
  for (const c of old) {
    const m = legacyToChannel(c);
    if (m) byId.set(m.id, m);
  }
  /* Requests are issued without awaiting: an upgrade transaction ends when the
     last one does, and a pause between two is a chance to end it early. */
  void cards.clear();
  for (const c of settleRungs([...byId.values()])) void cards.put(c);
}

/** Forget the connection, so the next call opens a fresh one. */
function forgetConnection(): void {
  instance = null;
  dbPromise = null;
}

/** Let go of the database and reload, so this tab runs the version the other
 *  tab is upgrading to. */
function standAsideForUpgrade(): void {
  instance?.close();
  forgetConnection();
  if (typeof location !== 'undefined') location.reload();
}

/** The error a blocked open rejects with. Waiting on the other tab instead
 *  would wait silently, for ever, on a page that says "Loading…". */
const blockedByAnotherTab = (): Error =>
  new Error(
    'This app is open in another tab or window on an older ' +
      'version, which has to close before this one can start. Close it, then reload.',
  );

/** Once the tab that blocked the open has closed, the open completes: hand
 *  that to the next caller rather than the rejection. */
function serveWhenUnblocked(open: Promise<IDBPDatabase<LearnessDB>>): void {
  open.then(
    () => {
      dbPromise = open;
    },
    () => {},
  );
}

/** The database, opened once. Rejects while another tab holds an older version
 *  open, naming that as the cause; once that tab has closed, a later call gets
 *  the database. */
export function db(): Promise<IDBPDatabase<LearnessDB>> {
  if (!dbPromise) {
    let rejectBlocked: (reason: Error) => void = () => {};
    const blocked = new Promise<never>((_, reject) => {
      rejectBlocked = reject;
    });
    const open = openDB<LearnessDB>(NAME, VERSION, {
      blocked() {
        rejectBlocked(blockedByAnotherTab());
      },
      blocking: standAsideForUpgrade,
      terminated: forgetConnection,
      async upgrade(d, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) createStores(d);
        if (oldVersion < 2) createClipStore(d);
        if (oldVersion >= 2 && oldVersion < 4) await dropOtherVoices(tx);
        if (oldVersion >= 1 && oldVersion < 5) await migrateToRungs(tx);
      },
    });
    open.then(
      (d) => {
        instance = d;
      },
      () => {},
    );
    dbPromise = Promise.race([open, blocked]);
    dbPromise.catch(() => serveWhenUnblocked(open));
  }
  return dbPromise;
}

/** Every preference, defaults included, so a caller never reads one back as
 *  undefined. Rows written over a copy of `DEFAULT_SETTINGS`. */
export async function getSettings(): Promise<Settings> {
  const d = await db();
  const rows = await d.getAll('settings');
  const out: Settings = { ...DEFAULT_SETTINGS };
  /* The store is name-to-anything by construction: this is the one place that
     has to trust what was written under a known name. */
  const loose = out as unknown as Record<string, unknown>;
  for (const r of rows) loose[r.name] = r.value;
  return out;
}

/** Write one preference. Typed against `Settings`, so a misspelt name or a
 *  value of the wrong kind is a compile error rather than a setting that
 *  silently never takes effect. */
export async function setSetting<K extends keyof Settings>(
  name: K,
  value: Settings[K],
): Promise<void> {
  const d = await db();
  await d.put('settings', { name, value });
}

/** One card by its id, or undefined where there is none. */
export const getCard = async (id: CardId): Promise<Card | undefined> =>
  (await db()).get('cards', id);

/** Write a card, creating or replacing. The caller owns `updatedAt`. */
export const putCard = async (card: Card): Promise<CardId> => (await db()).put('cards', card);

/** Every card on the device, retired ones included. */
export const allCards = async (): Promise<Card[]> => (await db()).getAll('cards');

/** Every rung of one word, on either channel. */
export const cardsFor = async (key: WordKey): Promise<Card[]> =>
  (await db()).getAllFromIndex('cards', 'key', key);

/** Append one answer to the log. Rows are never updated, only added. */
export async function logReview(entry: Review): Promise<void> {
  const d = await db();
  await d.add('reviews', entry);
}

/** The whole review log, oldest key first. */
export const allReviews = async (): Promise<Review[]> => (await db()).getAll('reviews');

/** Reviews at or after `ts`, oldest first.
 *
 *  @param ts milliseconds; the rows store Unix seconds and the bound is
 *            converted here.
 */
export async function reviewsSince(ts: number): Promise<Review[]> {
  const d = await db();
  return d.getAllFromIndex('reviews', 'ts', IDBKeyRange.lowerBound(Math.floor(ts / 1000)));
}

/** Offer the whole review log to the server again, by clearing the flag that
 *  marks a row as already sent. */
export async function unsendReviews(): Promise<void> {
  const d = await db();
  const tx = d.transaction('reviews', 'readwrite');
  for (let cur = await tx.store.openCursor(); cur; cur = await cur.continue()) {
    if (cur.value.synced) void cur.update({ ...cur.value, synced: false });
  }
  await tx.done;
}

/** Every word the learner added, tombstones included. */
export const userWords = async (): Promise<UserWord[]> => (await db()).getAll('words');

/** A clip's id: the word, the kind of clip and the engine that made it — the
 *  voice is part of the identity, so changing it never means guessing which
 *  model made what. */
export const clipId = (key: string, kind: Clip['kind'], engine: string): string =>
  `${key}|${kind}|${engine}`;

/** One clip by id, or undefined where it has not been made. */
export const getClip = async (id: string): Promise<Clip | undefined> =>
  (await db()).get('clips', id);

/** Every clip on the device, for the voice comparison. */
export const allClips = async (): Promise<Clip[]> => (await db()).getAll('clips');

/** Write a clip, creating or replacing. */
export const putClip = async (clip: Clip): Promise<string> => (await db()).put('clips', clip);

/** Every clip made for one word. */
export const clipsFor = async (key: string): Promise<Clip[]> =>
  (await db()).getAllFromIndex('clips', 'key', key);

/** Drop every clip of one word, for a word being removed. */
export async function deleteClipsFor(key: string): Promise<void> {
  const d = await db();
  for (const c of await d.getAllFromIndex('clips', 'key', key)) await d.delete('clips', c.id);
}

/** Write a word record, creating or replacing. The caller owns `updatedAt`. */
export const putUserWord = async (w: UserWord): Promise<WordKey> =>
  (await db()).put('words', w);

/** Remove a word record outright. Deleting a word the learner can still see
 *  uses a tombstone instead, so that the deletion travels. */
export const deleteUserWord = async (k: WordKey): Promise<void> =>
  (await db()).delete('words', k);

/** One piece of device-local scratch, or null where it has not been written. */
export async function getMeta<K extends keyof MetaValues>(
  name: K,
): Promise<MetaValues[K] | null> {
  const row = await (await db()).get('meta', name);
  return (row?.value as MetaValues[K] | undefined) ?? null;
}

/** Write one piece of device-local scratch. */
export const setMeta = async <K extends keyof MetaValues>(
  name: K,
  value: MetaValues[K],
): Promise<string> => (await db()).put('meta', { name, value });

/** Forget one piece of device-local scratch. */
export const clearMeta = async (name: keyof MetaValues): Promise<void> =>
  (await db()).delete('meta', name);

/** Every pasted lesson. */
export const lessons = async (): Promise<Lesson[]> => (await db()).getAll('lessons');

/** Record a pasted lesson. */
export const addLesson = async (lesson: Lesson): Promise<number> =>
  (await db()).add('lessons', lesson);

/** One card's scheduling state, in the shape the pipeline's importer reads. */
interface ExportedState {
  /** The word. */
  key: WordKey;
  /** The exercise, as a rung path or an old direction name. */
  direction: string;
  /** Answers given on this card. */
  reps: number;
  /** Times it has been forgotten after being learned. */
  lapses: number;
  /** The current interval in days. */
  ivl: number;
  /** FSRS difficulty, which the importer files under the SM-2 name. */
  ease: number;
  /** When it next comes round, in Unix seconds. */
  due: number;
  /** Whether a higher rung has overtaken it. */
  retired: boolean;
}

/** One answer, in the shape the pipeline's importer reads. */
interface ExportedReview {
  /** The word. */
  key: WordKey;
  /** The exercise. */
  direction: string;
  /** Unix seconds. */
  ts: number;
  /** What was pressed, 1-4. */
  rating: number;
  /** Milliseconds spent, or null. */
  ms: number | null;
}

/** Everything the learner owns, as one JSON-serialisable object. */
export interface ProgressExport {
  /** Unix seconds when the export was taken. */
  exported: number;
  /** One entry per card. */
  states: ExportedState[];
  /** The whole log. */
  reviews: ExportedReview[];
  /** Words added by hand. */
  words: UserWord[];
  /** Pasted lessons. */
  lessons: Lesson[];
}

/** How the importer names a card's exercise: a card that has never been
 *  migrated still carries an old direction, a migrated one its rung, and either
 *  is read. */
const exerciseName = (c: Card): string =>
  (c as LegacyCard).direction ?? `${c.channel}/${c.rung}`;

/** A file of everything learned, for `frcog import-app` to merge into the
 *  pipeline's database. Clips are not included. */
export async function exportProgress(): Promise<ProgressExport> {
  const d = await db();
  const [cards, reviews, words, lessonRows] = await Promise.all([
    d.getAll('cards'),
    d.getAll('reviews'),
    d.getAll('words'),
    d.getAll('lessons'),
  ]);
  return {
    exported: Math.floor(Date.now() / 1000),
    states: cards.map((c) => ({
      key: c.key,
      direction: exerciseName(c),
      reps: c.reps,
      lapses: c.lapses,
      ivl: c.scheduled_days,
      ease: c.difficulty,
      due: Math.floor(new Date(c.due).getTime() / 1000),
      retired: c.retired,
    })),
    reviews: reviews.map((r) => ({
      key: r.key,
      direction: r.direction,
      ts: r.ts,
      rating: r.rating,
      ms: r.ms,
    })),
    words,
    lessons: lessonRows,
  };
}
