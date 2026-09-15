/** Time, with its unit in the type.
 *
 *  The app speaks milliseconds, because that is what `Date` and every timer
 *  speak. The review log speaks seconds, because that is what it stores and
 *  what the sync wire carries. Nothing in a bare `number` says which is which,
 *  and the two are a thousand apart, so a value in the wrong unit does not
 *  crash: it silently means a different moment. That is exactly how the week
 *  window came to be asked for in milliseconds against an index of seconds —
 *  a cutoff fifty-six thousand years out, an empty result on every screen, and
 *  no error anywhere.
 *
 *  So the two are different types here, they cannot be passed for one another,
 *  and the only conversions between them are `msOf` and `secOf`. A plain
 *  `number` never crosses into either without going through this module.
 *
 *  Durations stay plain numbers. They are measured in milliseconds by
 *  convention, spelled `*_MS`, and adding one to an instant is `after`/`before`
 *  rather than arithmetic, so the result keeps its unit.
 */

declare const UNIT: unique symbol;

/** A moment, in milliseconds since the epoch — what `Date.now()` gives. */
export type Millis = number & { readonly [UNIT]: 'ms' };
/** A moment, in whole seconds since the epoch — what the review log stores. */
export type Seconds = number & { readonly [UNIT]: 's' };

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** Now, in milliseconds. */
export const nowMs = (): Millis => Date.now() as Millis;

/** Now, in whole seconds — the shape the log is written in. */
export const nowSec = (): Seconds => secOf(nowMs());

/** The moment `ms` milliseconds ago. The one way to build a cutoff: writing
 *  `Date.now() - WEEK_MS` yields a bare number, which no query will take. */
export const agoMs = (ms: number): Millis => (Date.now() - ms) as Millis;

/** `at` moved forwards (`after`) or backwards (`before`) by a duration. */
export const after = (at: Millis, ms: number): Millis => (at + ms) as Millis;
export const before = (at: Millis, ms: number): Millis => (at - ms) as Millis;

/** Seconds to milliseconds: the log's unit into the app's. */
export const msOf = (ts: Seconds): Millis => (ts * SECOND_MS) as Millis;

/** Milliseconds to whole seconds, rounded down: the app's unit into the log's.
 *  Down rather than nearest, so a review never records a moment that has not
 *  happened yet. */
export const secOf = (at: Millis): Seconds => Math.floor(at / SECOND_MS) as Seconds;

/** A `Date` as milliseconds. */
export const atMs = (date: Date): Millis => date.getTime() as Millis;

/** What IndexedDB hands back for a date: the `Date` it stored, or the string a
 *  sync put there, since JSON has no date type. Every reader goes through
 *  `whenMs`, which is why a pulled card and a local one compare alike. */
export type DateLike = Date | string | number;

/** Any of those as milliseconds. An unreadable value is the epoch rather than
 *  NaN: a card with a broken due date must sort as overdue and be answered,
 *  not vanish out of every comparison it takes part in. */
export function whenMs(value: DateLike | null | undefined): Millis {
  if (value === null || value === undefined) return 0 as Millis;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return (Number.isFinite(ms) ? ms : 0) as Millis;
}

/** Milliseconds that came from outside — a stored row, a parsed number — where
 *  the unit is known by inspection rather than by the type system. Kept
 *  explicit so every such claim is greppable. */
export const trustMs = (ms: number): Millis => ms as Millis;

/** Seconds that came from outside, likewise: a review row read back from the
 *  database or pulled from the server. */
export const trustSec = (ts: number): Seconds => ts as Seconds;

/** Does this number look like milliseconds rather than seconds?
 *
 *  A guard for the boundary where the two meet. Any moment this app cares
 *  about is after 2001 in milliseconds (1e12) and before the year 5000 in
 *  seconds (1e11), so the gap between them is unambiguous for every date a
 *  learner can have studied on.
 */
export const looksLikeMillis = (n: number): boolean => Math.abs(n) >= 1e11;
