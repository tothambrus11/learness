/** Local storage for everything the learner owns: cards, the review log, the
 *  words added by hand, and the audio made on this device. */

/* IndexedDB rather than localStorage: the review log is append-only and kept
   forever, both because it is the record of what you actually did and because
   FSRS can later retune its own parameters from it. That outgrows a 5 MB
   string store. */
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

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

/* Declared for `idb` so that a typo in a store or index name is a compile
   error rather than a runtime one on a device that has already upgraded. */
/** Every store, its key type, its value type and its indexes. */
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

/** The database, opened once. Rejects while another tab holds an older version
 *  open, naming that as the cause; once that tab has closed, a later call gets
 *  the database. */
export function db(): Promise<IDBPDatabase<LearnessDB>> {
  /* Opening at a newer version than another tab still holds open waits for
     that tab — silently, for ever, on a page that says "Loading…". So a
     blocked open is reported as an error instead, and an older tab that is
     told a newer one wants in lets go and reloads onto the new version. */
  if (!dbPromise) {
    let rejectBlocked: (reason: Error) => void = () => {};
    const blocked = new Promise<never>((_, reject) => {
      rejectBlocked = reject;
    });
    const open = openDB<LearnessDB>(NAME, VERSION, {
      blocked() {
        rejectBlocked(
          new Error(
            'This app is open in another tab or window on an older ' +
              'version, which has to close before this one can start. Close it, then reload.',
          ),
        );
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

          d.createObjectStore('words', { keyPath: 'k' }); // added by hand
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
          /* Rows written before version 5 carry `direction` and no rung, which
             is exactly what `legacyToChannel` is for. */
          const old = (await cards.getAll()) as unknown as LegacyCard[];
          const byId = new Map<CardId, Card>();
          for (const c of old) {
            const m = legacyToChannel(c);
            if (m) byId.set(m.id, m);
          }
          /* Issued together, not awaited one by one: the upgrade transaction
             finishes when the last request does, and a pause between requests
             is a chance for a slower engine to call it finished early. */
          void cards.clear();
          for (const c of settleRungs([...byId.values()])) void cards.put(c);
        }
      },
    });
    open.then(
      (d) => {
        instance = d;
      },
      () => {},
    );
    dbPromise = Promise.race([open, blocked]);
    /* Blocked now is not blocked for ever: once the other tab closes, the
       open completes, and the next call should have it. */
    dbPromise.catch(() => {
      open.then(
        () => {
          dbPromise = open;
        },
        () => {},
      );
    });
  }
  return dbPromise;
}

/** Every preference, defaults included, so a caller never reads one back as
 *  undefined. Rows written over a copy of `DEFAULT_SETTINGS`. */
export async function getSettings(): Promise<Settings> {
  const d = await db();
  const rows = await d.getAll('settings');
  const out: Settings = { ...DEFAULT_SETTINGS };
  /* The store is name-to-anything by construction, so this is the one place
     that has to trust what was written under a known name. */
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
  /* Passing the millisecond bound straight through compared it against a
     seconds index: a thousandfold too high, so the query matched nothing and
     recall read as "—" for ever while the new-word throttle never fired. */
  return d.getAllFromIndex('reviews', 'ts', IDBKeyRange.lowerBound(Math.floor(ts / 1000)));
}

/** Every word the learner added, tombstones included. */
export const userWords = async (): Promise<UserWord[]> => (await db()).getAll('words');

/* The voice is in the id so that changing it does not mean guessing which
   model made what. */
/** A clip's id: the word, the kind of clip and the engine that made it. */
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
  /* Disposable by design: the sitting in progress is a position in a queue,
     not something learned, and it is rebuilt from the cards whenever it does
     not apply. */
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

/** A file of everything learned, for `frcog import-app` to merge into the
 *  pipeline's database. Clips are not included. */
export async function exportProgress(): Promise<ProgressExport> {
  /* Clips are left out: they are megabytes, they are device-local, and the
     pipeline has its own audio. */
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
      /* A card that has never been migrated still names an old direction; one
         that has names its rung. The importer reads either. */
      direction: (c as LegacyCard).direction ?? `${c.channel}/${c.rung}`,
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
