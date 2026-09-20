/** One account's word list and the state of its cards, over D1.
 *
 *  The connector needs four things of the database: the words the learner
 *  holds, tombstones included; the cards, for where each word stands; a way
 *  to write words; and the counts the progress tool reports. Everything else
 *  in the schema — the review log above all — is not reachable from here,
 *  which is what makes a `words` token safe to hand to a Claude session: the
 *  worst a mistake can do is a bad word-list edit, visible and undoable.
 *
 *  Rows are the app's own records, stored whole. They are read back through
 *  `trustUserWord`, the one place a row stops being JSON and becomes a word.
 */
import type { StoredCard, UserWord } from '../../app/src/lib/model.js';
import type { Env, WireWord } from './env.js';

/* Sequence numbers are per account, so one person's writes never advance
   another's pull cursor. The counter is moved on and read in one statement:
   it was an UPDATE and then a SELECT, and two syncs on one account at once —
   two devices, or a retry — could each read the other's total and stamp two
   rows with the same number, while a cursor taken between the two could
   pass a row that was numbered but not yet there. */

/** The statement that moves the account's counter on by `count` and answers
 *  with where it now stands; the numbers reserved are the `count` below it.
 *  One statement, so no other request's move can fall between the move and
 *  the read. */
const reserve = (env: Env, userId: string, count: number): D1PreparedStatement =>
  env.DB.prepare(
    `INSERT INTO counter (user_id, value) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET value = value + excluded.value
     RETURNING value`).bind(userId, count);

/** Reserves `count` numbers and returns the first. Two calls never hand out
 *  the same number, on the same account, however they overlap. What this
 *  does not promise: that the rows a caller then writes are there by the
 *  time another request reads the counter — for that, the rows go in the
 *  same batch as the reservation, which is `seqRun`. */
export async function nextSeq(env: Env, userId: string, count: number): Promise<number> {
  const row = await reserve(env, userId, count).first<{ value: number }>();
  if (!row) throw new Error('the sequence counter gave no answer');
  return row.value - count;
}

/** A run of `count` numbers, stamped on rows in the same batch that reserves
 *  them. `reserve` goes first in the batch; a row's INSERT puts `at` where
 *  its `seq` value goes and `binds(i)` after its own values, and the i-th row
 *  written gets the i-th number of the run. A D1 batch is one transaction,
 *  so the counter never stands past a row that is not yet in the table:
 *  a cursor read by another request either sees the rows or is below them. */
export interface SeqRun {
  reserve: D1PreparedStatement;
  at: string;
  binds(i: number): [string, number];
}

export function seqRun(env: Env, userId: string, count: number): SeqRun {
  return {
    reserve: reserve(env, userId, count),
    /* The counter after the reservation is the first number past the run;
       counting back from it is what makes the value one transaction old. */
    at: '((SELECT value FROM counter WHERE user_id = ?) - ?)',
    binds: (i) => [userId, count - i],
  };
}

/** The first number not yet handed out on this account: zero before any is. */
export const currentSeq = async (env: Env, userId: string): Promise<number> =>
  (await env.DB.prepare('SELECT value FROM counter WHERE user_id = ?')
    .bind(userId).first<{ value: number }>())?.value ?? 0;

/** A word as the database or a request body holds it, made the app's record.
 *  Rows written by the first connector and by an older app hold `en` as a
 *  string, which every reader of the app still copes with; here it becomes
 *  the list it should have been, once. */
export function trustUserWord(raw: WireWord): UserWord {
  const en = Array.isArray(raw.en) ? raw.en.map(String)
    : typeof raw.en === 'string' ? raw.en.split(/\s*[,;]\s*/).filter(Boolean) : [];
  return { ...(raw as unknown as UserWord), en };
}

/** The account's words and cards, as the tools see them. */
export interface WordStore {
  /** Every word in the list, newest write last. Tombstones are included only
   *  when asked for: a removed word is not in the list, but re-adding it must
   *  know it was there. */
  words(options?: { includeDeleted?: boolean }): Promise<UserWord[]>;
  /** The learner's cards — identity and scheduling state, for `statusOf`.
   *  This is the one thing the `words` scope reads outside the word list, and
   *  it is why the connector can say "you already know this one". */
  cards(): Promise<StoredCard[]>;
  /** Write words, last write wins on `updatedAt`. Returns how many were sent. */
  put(words: readonly UserWord[]): Promise<number>;
  /** How much there is: counts only, never contents. */
  counts(): Promise<{ words: number; cards: number; reviews: number; lessons: number }>;
}

export function d1WordStore(env: Env, user: string): WordStore {
  return {
    async words({ includeDeleted = false } = {}) {
      const rows = await env.DB.prepare(
        `SELECT data FROM words WHERE user_id = ?${includeDeleted ? '' : ' AND deleted = 0'}
         ORDER BY seq`).bind(user).all<{ data: string }>();
      return rows.results.map((r) => trustUserWord(JSON.parse(r.data) as WireWord));
    },
    async cards() {
      const rows = await env.DB.prepare('SELECT data FROM cards WHERE user_id = ?')
        .bind(user).all<{ data: string }>();
      /* Cards are the app's own records, stored whole; this is where the
         server trusts them to be. */
      return rows.results.map((r) => JSON.parse(r.data) as StoredCard);
    },
    async put(words) {
      if (!words.length) return 0;
      const run = seqRun(env, user, words.length);
      const now = Date.now();
      await env.DB.batch([run.reserve, ...words.map((w, i) => {
        const record = { ...w, updatedAt: w.updatedAt ?? now };
        return env.DB.prepare(
          `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq)
           VALUES (?,?,?,?,?,${run.at})
           ON CONFLICT(user_id, k) DO UPDATE SET data=excluded.data,
             updatedAt=excluded.updatedAt, deleted=excluded.deleted, seq=excluded.seq
           WHERE excluded.updatedAt > words.updatedAt`)
          .bind(user, record.k, JSON.stringify(record), record.updatedAt,
            record.deleted ? 1 : 0, ...run.binds(i));
      })]);
      return words.length;
    },
    async counts() {
      const count = async (table: string, where = ''): Promise<number> =>
        (await env.DB.prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id = ?${where}`)
          .bind(user).first<{ n: number }>())?.n ?? 0;
      return {
        words: await count('words', ' AND deleted = 0'),
        cards: await count('cards'),
        reviews: await count('reviews'),
        lessons: await count('lessons'),
      };
    },
  };
}
