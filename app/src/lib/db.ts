/** Local storage for everything the learner owns.
 *
 *  IndexedDB rather than localStorage: the review log is append-only and kept
 *  forever, both because it is the record of what you actually did and because
 *  FSRS can later retune its own parameters from it. That outgrows a 5 MB
 *  string store.
 */
import { openDB } from 'idb';
import type { Theme } from './theme.js';
import type { DBSchema, IDBPDatabase } from 'idb';
import { legacyToChannel, settleRungs } from './ladder.js';
import { DEFAULT_DAY_STARTS_AT } from './progress.js';
import type { CardId, WordKey } from './keys.js';
import type {
  Attempt, BitState, Clip, Lesson, Review, RuleCard, Settings, StoredCard, UserWord,
} from './model.js';
import { looksLikeMillis, nowMs, nowSec, secOf, whenMs } from './units.js';
import type { Millis, Seconds } from './units.js';

const NAME = 'frcog';
const VERSION = 8;

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
  /** A lesson's id is a uuid. The store was made with an auto-increment key
   *  and still carries it, but every lesson has arrived with its own id
   *  since lessons could be synced: a number would be one device's count. */
  lessons: { key: string; value: Lesson };
  settings: { key: string; value: NamedValue };
  meta: { key: string; value: NamedValue };
  clips: { key: string; value: Clip; indexes: { key: string } };
  /** The learner's own themes and their edits of the built-ins (theme.ts).
   *  Synced, with a tombstone, like words. */
  themes: { key: string; value: Theme };
  /** The grammar bits the learner has committed to (model.ts BitState),
   *  keyed by the rule's id. Synced, with a tombstone, like words. */
  bits: { key: string; value: BitState };
  /** The FSRS state of each grammar rule in each mode (model.ts RuleCard),
   *  keyed "<rule>|<mode>". Synced last-write-wins, like cards. */
  rulecards: { key: string; value: RuleCard };
  /** The grammar's log: one row per exercise answered (model.ts Attempt).
   *  Append-only, synced as a set on `uid`, like reviews. */
  attempts: {
    key: number;
    value: Attempt;
    indexes: { ts: Seconds; instance: string };
  };
}

export const DEFAULT_SETTINGS: Settings = {
  minutesByWeekday: [20, 20, 20, 20, 20, 20, 20],   // the real budget, Monday first
  dayStartsAt: DEFAULT_DAY_STARTS_AT,   // the hour the day turns: a sitting after midnight is the evening's
  maxNewPerDay: 20,         // ceiling, even on an empty day
  desiredRetention: 0.9,    // FSRS dial: how much you are willing to forget
  refresherShare: 0.08,     // slice of each session spent on old, not-yet-due words
  costPerNewWord: 2.5,      // same-day reviews one new word generates
  leechThreshold: 6,        // lapses before a card is flagged and reset
  sessionLimit: 60,         // cards offered in one sitting
  exploreEvery: 5,          // one new card every few: the exploration share
  autoSync: 'always',       // off | unmetered | always. ~30 kB, so not worth gating
  autoSyncMinutes: 15,      // never sync automatically more often than this
  bulkDownload: 'unmetered',// off | unmetered | always. Audio is megabytes, so this is gated
  bulkConsent: false,       // "yes, download on this connection", remembered per device
  formGap: { mode: 'fixed', ms: 0 },   // a tense read aloud runs on, line to line
  capClips: false,          // keep the clips the voice makes under a size
  clipCacheMb: 200,         // that size, in MB, once the cap is on
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
        if (oldVersion < 6) {
          /* Colour themes the learner made or edited (#66). Synced, so a
             theme is one record with a tombstone, like a word. */
          d.createObjectStore('themes', { keyPath: 'id' });
        }
        if (oldVersion < 7) {
          /* The grammar bits the learner has opened (GRAMMAR.md). Made
             empty on purpose: the tenses the form channel had been asking
             for were opened for the learner by a rotation, and that is the
             complaint the store answers. Nothing is opened until they do. */
          d.createObjectStore('bits', { keyPath: 'id' });
        }
        if (oldVersion < 8) {
          /* The grammar's own state and log (GRAMMAR.md, "The records"). */
          d.createObjectStore('rulecards', { keyPath: 'id' });
          const attempts = d.createObjectStore('attempts', { keyPath: 'i', autoIncrement: true });
          attempts.createIndex('ts', 'ts');
          attempts.createIndex('instance', 'instance');
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
  /* A list handed over by a screen is a `$state` proxy, which the structured
     clone refuses — the same DataCloneError `putUserWord` guards against —
     so it is copied on the way in. */
  await d.put('settings', { name, value: Array.isArray(value) ? value.slice() as Settings[K] : value });
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
export const deleteClip = async (id: string): Promise<void> => (await db()).delete('clips', id);
/** Note a clip as heard now, for the cap to evict by. A clip that is not
 *  there — evicted between being found and being played — is left alone. */
export async function touchClip(id: string, at: Millis = nowMs()): Promise<void> {
  const tx = (await db()).transaction('clips', 'readwrite');
  const clip = await tx.store.get(id);
  if (clip) await tx.store.put({ ...clip, lastUsed: at });
  await tx.done;
}
export async function deleteClipsFor(key: string): Promise<void> {
  const d = await db();
  for (const c of await d.getAllFromIndex('clips', 'key', key)) await d.delete('clips', c.id);
}
/* There is no delete: a word is removed by a tombstone (words.ts), so that
   the removal travels to the other devices instead of being resurrected. */
/** Store one of your words.
 *
 *  Copied on the way in, the record and its translations both. A screen hands
 *  over what it is holding, and what a Svelte screen holds is a reactive proxy
 *  — IndexedDB's structured clone cannot copy one, and says so with
 *  `DataCloneError: [object Array] could not be cloned`, which reaches the
 *  learner as an Add button that does nothing. The word is plain data, so a
 *  plain copy of it is the whole fix, and it belongs here rather than in every
 *  screen that ever calls this.
 *
 *  `en` is copied only where it is an array. A row written by an older version
 *  or by the MCP server may hold a string — `toStudyWord` and `gloss` both
 *  still read one — and spreading that would store a word whose translations
 *  were its letters. */
export const putUserWord = async (w: UserWord): Promise<WordKey> =>
  (await db()).put('words', Array.isArray(w.en) ? { ...w, en: [...w.en] } : { ...w });

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
export const addLesson = async (lesson: Lesson): Promise<string> =>
  (await db()).add('lessons', lesson);

/** Every theme record on this device, tombstones included: what the sync
 *  and the export carry. `themesInUse` (theme.ts) is what is offered. */
export const allThemes = async (): Promise<Theme[]> => (await db()).getAll('themes');
/** Store a theme record, whole. The caller has already trusted it and set
 *  `updatedAt`; a `$state` proxy is copied on the way in, for the structured
 *  clone's sake. */
export const putTheme = async (theme: Theme): Promise<string> =>
  (await db()).put('themes', { ...theme, colours: { ...theme.colours } });

/** Every bit record, closed ones included: what a sync pushes. */
export const allBits = async (): Promise<BitState[]> => (await db()).getAll('bits');
/** The bits the learner has open: the ones whose rules may be asked. */
export async function openBits(): Promise<BitState[]> {
  return (await allBits()).filter((b) => !b.deleted);
}
export const putBit = async (bit: BitState): Promise<string> => (await db()).put('bits', bit);

export const getRuleCard = async (id: string): Promise<RuleCard | undefined> =>
  (await db()).get('rulecards', id);
export const putRuleCard = async (card: RuleCard): Promise<string> =>
  (await db()).put('rulecards', card);
export const allRuleCards = async (): Promise<RuleCard[]> => (await db()).getAll('rulecards');

export async function logAttempt(entry: Attempt): Promise<void> {
  const d = await db();
  await d.add('attempts', entry);
}
export const allAttempts = async (): Promise<Attempt[]> => (await db()).getAll('attempts');
/** Attempts since a cutoff in milliseconds; the log stores seconds, and the
 *  unit is checked here as `reviewsSince` checks it. */
export async function attemptsSince(at: Millis): Promise<Attempt[]> {
  if (!looksLikeMillis(at)) {
    throw new Error(`attemptsSince wants a moment in milliseconds, got ${at}`);
  }
  const d = await db();
  return d.getAllFromIndex('attempts', 'ts', IDBKeyRange.lowerBound(secOf(at)));
}

/** Everything this device knows, in the shape the pipeline imports. */
export async function exportProgress(): Promise<{
  exported: Seconds;
  states: unknown[];
  reviews: unknown[];
  words: UserWord[];
  lessons: Lesson[];
  themes: Theme[];
  bits: BitState[];
  rulecards: RuleCard[];
  attempts: Attempt[];
}> {
  const d = await db();
  const [cards, reviews, words, lessonRows, themes, bits, rulecards, attempts] = await Promise.all([
    d.getAll('cards'), d.getAll('reviews'), d.getAll('words'), d.getAll('lessons'),
    d.getAll('themes'), d.getAll('bits'), d.getAll('rulecards'), d.getAll('attempts'),
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
    words, lessons: lessonRows, themes, bits, rulecards, attempts,
  };
}
