/** The shapes that cross the wire, as the Worker sees them. They must stay in
 *  step with the app's `app/src/lib/types.ts`, whose `SyncPush`, `SyncPull` and
 *  `SyncResponse` the sync shapes here mirror: the two packages build
 *  separately and cannot import from one another, so nothing enforces the
 *  agreement but a person reading both.
 *
 *  Two things are looser here than in the app. A pushed record is stored as the
 *  JSON it arrived as and handed back untouched, so every field but the two or
 *  three a row is keyed and ordered by rides along under an index signature.
 *  And a body field is whatever a client actually sent, so it stays `unknown`
 *  until one of the readers below has coerced or refused it. */

/* ---------------------------------------------------------------- bodies -- */

/** A JSON value that arrived as an object: not null, and not an array. Its
 *  values are `unknown`, nothing about an inbound body being known until it has
 *  been checked. */
export type JsonRecord = Record<string, unknown>;

/** True when a parsed JSON value can have named fields read off it. Arrays and
 *  `null` are rejected; callers substitute an empty object for anything refused,
 *  so a malformed body takes the same path an empty one takes. */
export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The request's JSON body as an object. A body that is absent, truncated, not
 *  JSON, or JSON that is not an object is an empty object, so a handler's own
 *  missing-field check produces the error rather than a parse failure producing
 *  a 500. */
export async function readJsonObject(request: Request): Promise<JsonRecord> {
  const parsed: unknown = await request.json().catch(() => ({}));
  return isJsonRecord(parsed) ? parsed : {};
}

/** A body field as a string: a number or a boolean stringified — so a six-digit
 *  code sent as a JSON number still verifies — and everything else, falsy
 *  values and objects and arrays alike, the empty string, which no endpoint
 *  accepts. */
export function bodyString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/* ------------------------------------------------------------------ rows -- */

/** A word the learner added, on the wire. Mirrors the app's `UserWord`. */
export interface WireUserWord {
  /** The word's identity, `"<lemma>|<pos>"`. The row key, with the account. */
  k: string;
  /** Milliseconds at the last edit. The merge's tie-break: a push only
   *  overwrites a stored row whose `updatedAt` is older, so an out-of-order
   *  delivery cannot undo a newer edit. Absent counts as 0. */
  updatedAt?: number;
  /** A tombstone. The row stays so the deletion can travel. */
  deleted?: boolean;
  /** Everything else the app keeps on a word — the French, the translations,
   *  the part of speech, the note. Stored and handed back verbatim; the Worker
   *  never looks at it. */
  [field: string]: unknown;
}

/** One rung of one word, on the wire. Mirrors the app's `Card`. */
export interface WireCard {
  /** `"<word key>|<channel>|<rung>"`. The row key, with the account. */
  id: string;
  /** Milliseconds at the last local write; the merge's tie-break, exactly as
   *  for a word. Absent counts as 0. */
  updatedAt?: number;
  /** The scheduling state — due date, stability, difficulty, the rest of what
   *  FSRS keeps. Round-tripped untouched. */
  [field: string]: unknown;
}

/** One answer as it was given, on the wire. Mirrors the app's `Review`. The log
 *  is append-only: rows are inserted and never updated, so merging two devices'
 *  logs is a set union. */
export interface WireReview {
  /** Unique across every device — minted with `crypto.randomUUID()` at the
   *  moment of the answer. The row key, with the account, and the reason a
   *  re-push is a no-op rather than a duplicate. */
  uid: string;
  /** Unix seconds, not milliseconds: the log is the one place in the protocol
   *  that does not use milliseconds, because seconds are what the pipeline's
   *  database expects. Absent counts as 0. */
  ts?: number;
  /** The card, the word, the grade, the time taken. Round-tripped untouched. */
  [field: string]: unknown;
}

/** A pasted lesson, on the wire. Mirrors the app's `Lesson`. */
export interface WireLesson {
  /** A UUID, or IndexedDB's auto-increment number on the oldest rows, which is
   *  why the Worker keys the row by `String(id)` rather than by the value. */
  id: string | number;
  /** Milliseconds at the last edit; the merge's tie-break. Absent counts as 0. */
  updatedAt?: number;
  /** The label and the word keys it introduced. Round-tripped untouched. */
  [field: string]: unknown;
}

/** Any record a sync moves, in either direction. */
export type WireRecord = WireUserWord | WireCard | WireReview | WireLesson;

/** A stored record, parsed back out of its `data` column and trusted as it
 *  stands: the column holds exactly the JSON a device pushed and this Worker is
 *  what put it there. Throws if the column does not hold JSON. */
export function storedRecord(data: string): WireRecord {
  return JSON.parse(data);
}

/* ------------------------------------------------------------------ sync -- */

/** The four tables a sync moves, in the order the Worker pages them. `as const`
 *  so that a table name read off it indexes the pull and the counts. */
export const SYNC_TABLES = ['words', 'cards', 'reviews', 'lessons'] as const;

/** One of the four synced tables, and a key of both `SyncPullWire` and the
 *  pushed-row counts. */
export type SyncTable = (typeof SYNC_TABLES)[number];

/** What a device says it has that the server has not seen. Mirrors the app's
 *  `SyncPush`, except that every table is optional and a missing one is no
 *  rows. */
export interface SyncPushWire {
  /** Words changed since the last sync, tombstones included. */
  words?: WireUserWord[];
  /** Cards changed since the last sync. */
  cards?: WireCard[];
  /** Reviews never yet accepted by the server. */
  reviews?: WireReview[];
  /** Lessons changed since the last sync. */
  lessons?: WireLesson[];
}

/** The push half of a sync body, with all four tables present as arrays: a
 *  table that arrived as anything but an array is an empty array, so the count
 *  that reserves sequence numbers and the loop that spends them cannot disagree.
 *  The elements themselves are taken as they came. */
export function syncPush(value: unknown): SyncPushWire {
  const push: JsonRecord = isJsonRecord(value) ? value : {};
  return {
    words: Array.isArray(push.words) ? push.words : [],
    cards: Array.isArray(push.cards) ? push.cards : [],
    reviews: Array.isArray(push.reviews) ? push.reviews : [],
    lessons: Array.isArray(push.lessons) ? push.lessons : [],
  };
}

/** The words a `POST /v1/words` body carries, from a bare array or from the
 *  `words` of an object. Anything else is no words. */
export function incomingWords(body: unknown): WireUserWord[] {
  if (Array.isArray(body)) return body;
  if (isJsonRecord(body) && Array.isArray(body.words)) return body.words;
  return [];
}

/** The body of `POST /v1/sync`. */
export interface SyncRequestBody {
  /** The sequence the device already has everything up to. Coerced with
   *  `Number()`: a string or a missing value reads as 0, which sends the whole
   *  account. */
  since?: unknown;
  /** The rows to write. Anything that is not an object is treated as no push
   *  at all. */
  push?: unknown;
}

/** What the server sends back: everything past the device's cursor, one page of
 *  each table at a time. All four tables share `WireRecord[]`, where the app's
 *  `SyncPull` names a type per table, because the rows are the JSON the devices
 *  pushed, parsed and handed straight on. */
export type SyncPullWire = { [table in SyncTable]?: WireRecord[] };

/** One round trip's answer. Mirrors the app's `SyncResponse`. */
export interface SyncResponseBody {
  /** The newest sequence the device now has every row up to. Where a table
   *  filled its page there may be more behind it, so this stops at that page's
   *  last row rather than at the account's current sequence. */
  cursor: number;
  /** True when a table filled its page and there is more behind it. The device
   *  comes straight back rather than waiting for the next sync. */
  more: boolean;
  /** How many rows of each table the push offered. A count, not an
   *  acknowledgement: a row whose `updatedAt` lost to the stored one is
   *  counted here and still did not change anything. */
  pushed: Record<SyncTable, number>;
  /** The rows themselves, one page of each table. */
  pull: SyncPullWire;
}

/* ----------------------------------------------------------- auth bodies -- */

/** The body of `POST /v1/auth/request`: ask for a code. */
export interface RequestCodeBody {
  /** Where to send the code. Normalised, then shape-checked, so an obvious typo
   *  fails here rather than by never arriving. */
  email?: unknown;
}

/** The body of `POST /v1/auth/verify`: hand a code back. */
export interface VerifyCodeBody {
  /** The address the code was sent to. */
  email?: unknown;
  /** The six digits, coerced with `String()` so a client that sent them as a
   *  number still verifies. */
  code?: unknown;
  /** `'words'` asks for a token that may only use the word list; anything else
   *  means a full token. */
  scope?: unknown;
  /** What to call this device in the device list, trimmed to 60 characters.
   *  Anything that is not a non-empty string falls back to a default. */
  name?: unknown;
}

/** The body of `POST /v1/auth/device`: mint a token for an Access session. */
export interface DeviceBody {
  /** `'words'` asks for a word-list-only token; anything else means full. */
  scope?: unknown;
  /** What to call the device in the device list. */
  name?: unknown;
}

/** The device name a body asked for. Accepts only a non-empty string — the one
 *  body field the Worker stores rather than coerces — and anything else, an
 *  empty string or a number or an object alike, is `fallback`. */
export function deviceName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
