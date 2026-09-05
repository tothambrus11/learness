/** Local storage for everything the learner owns.
 *
 *  IndexedDB rather than localStorage: the review log is append-only and kept
 *  forever, both because it is the record of what you actually did and because
 *  FSRS can later retune its own parameters from it. That outgrows a 5 MB
 *  string store.
 */
import { openDB } from 'idb';

const NAME = 'frcog';
const VERSION = 1;

export const DEFAULT_SETTINGS = {
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

let dbPromise = null;

export function db() {
  if (!dbPromise) {
    dbPromise = openDB(NAME, VERSION, {
      upgrade(d) {
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
      },
    });
  }
  return dbPromise;
}

export async function getSettings() {
  const d = await db();
  const rows = await d.getAll('settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.name] = r.value;
  return out;
}

export async function setSetting(name, value) {
  const d = await db();
  await d.put('settings', { name, value });
}

export const getCard = async (id) => (await db()).get('cards', id);
export const putCard = async (card) => (await db()).put('cards', card);
export const allCards = async () => (await db()).getAll('cards');

export async function logReview(entry) {
  const d = await db();
  await d.add('reviews', entry);
}

/** Reviews since a cutoff, newest first. Used for the retention measure that
 *  throttles how many new words the day introduces. */
export async function reviewsSince(ts) {
  const d = await db();
  return d.getAllFromIndex('reviews', 'ts', IDBKeyRange.lowerBound(ts));
}

export const userWords = async () => (await db()).getAll('words');
export const putUserWord = async (w) => (await db()).put('words', w);
export const deleteUserWord = async (k) => (await db()).delete('words', k);

export const lessons = async () => (await db()).getAll('lessons');
export const addLesson = async (lesson) => (await db()).add('lessons', lesson);

export async function exportProgress() {
  const d = await db();
  const [cards, reviews, words, lessonRows] = await Promise.all([
    d.getAll('cards'), d.getAll('reviews'), d.getAll('words'), d.getAll('lessons'),
  ]);
  return {
    exported: Math.floor(Date.now() / 1000),
    states: cards.map((c) => ({
      key: c.key, direction: c.direction, reps: c.reps, lapses: c.lapses,
      ivl: c.scheduled_days, ease: c.difficulty, due: Math.floor(new Date(c.due) / 1000),
    })),
    reviews: reviews.map((r) => ({
      key: r.key, direction: r.direction, ts: r.ts, rating: r.rating, ms: r.ms,
    })),
    words, lessons: lessonRows,
  };
}
