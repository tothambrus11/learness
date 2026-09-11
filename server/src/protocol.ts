/** The shapes that cross the wire, as the Worker sees them.
 *
 *  **These must stay in step with the app's `app/src/lib/types.ts`.** The two
 *  packages cannot import from one another — the app is a SvelteKit build and
 *  this is a Worker bundle, with separate `node_modules` and separate
 *  tsconfigs — so the agreement between them is this file plus that one, and
 *  nothing enforces it but a person reading both. `SyncPush`, `SyncPull` and
 *  `SyncResponse` there are the names these mirror.
 *
 *  Two things are deliberately looser here than in the app.
 *
 *  First, the Worker is a post box, not a reader. It stores each pushed record
 *  as the JSON it arrived as and hands it back untouched, and looks only at
 *  the two or three fields it needs to key and order a row by. Every other
 *  field rides along under an index signature, so adding a field to `Card` in
 *  the app needs no change here and cannot be dropped in transit by a Worker
 *  that has not been redeployed.
 *
 *  Second, a body is whatever a client actually sent, which is not necessarily
 *  what it should have sent. Fields the old JavaScript coerced with `String()`
 *  or `Number()` stay `unknown` here so that coercion still reads the same way
 *  and still produces the same answer for a wrong-typed value.
 */

/* ---------------------------------------------------------------- bodies -- */

/** A JSON value that arrived as an object: not null, and not an array.
 *
 *  Named so that reading a field off a parsed body is a narrowing rather than
 *  a cast. Values are `unknown` because nothing about an inbound body is known
 *  until it has been checked.
 */
export type JsonRecord = Record<string, unknown>;

/** True when a parsed JSON value can have named fields read off it.
 *
 *  Arrays and `null` are rejected, which matches how the old code behaved for
 *  both: `null.push` threw, and an array's `.words` was undefined. Callers
 *  substitute an empty object for anything this refuses, so a malformed body
 *  takes the same path an empty one always took.
 */
export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The request's JSON body as an object, or an empty object.
 *
 *  Replaces the `await request.json().catch(() => ({}))` that every handler
 *  used to write out: a body that is absent, truncated, not JSON, or JSON that
 *  is not an object all become `{}`, and the handler's own missing-field check
 *  produces the error rather than a parse failure producing a 500.
 */
export async function readJsonObject(request: Request): Promise<JsonRecord> {
  const parsed: unknown = await request.json().catch(() => ({}));
  return isJsonRecord(parsed) ? parsed : {};
}

/** A body field as the string the untyped code's `String(field || '')` gave.
 *
 *  A client that sent a six-digit code as a JSON number still verifies, which
 *  is the case this exists for. Everything falsy is the empty string, as the
 *  `|| ''` always made it; an object, which used to stringify to the useless
 *  `'[object Object]'`, is the empty string too, since no endpoint has ever
 *  accepted either.
 */
export function bodyString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/* ------------------------------------------------------------------ rows -- */

/** A word the learner added, on the wire. Mirrors the app's `UserWord`.
 *
 *  Deletion is a tombstone rather than a removal, so that it travels to the
 *  other devices instead of being resurrected by them.
 */
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

/** One answer as it was given, on the wire. Mirrors the app's `Review`.
 *
 *  The log is append-only, which is what makes merging a set union: rows are
 *  inserted with `INSERT OR IGNORE` and never updated, so the same row
 *  arriving twice costs nothing and loses nothing.
 */
export interface WireReview {
  /** Unique across every device — minted with `crypto.randomUUID()` at the
   *  moment of the answer. The row key, with the account, and the reason a
   *  re-push is a no-op rather than a duplicate. */
  uid: string;
  /** Unix **seconds**, not milliseconds: the log is the one place that uses
   *  seconds, because that is the format the pipeline's database expects.
   *  Absent counts as 0. */
  ts?: number;
  /** The card, the word, the grade, the time taken. Round-tripped untouched. */
  [field: string]: unknown;
}

/** A pasted lesson, on the wire. Mirrors the app's `Lesson`. */
export interface WireLesson {
  /** A UUID, or IndexedDB's auto-increment number on the oldest rows — which
   *  is why the Worker stores `String(id)` rather than the value itself. */
  id: string | number;
  /** Milliseconds at the last edit; the merge's tie-break. Absent counts as 0. */
  updatedAt?: number;
  /** The label and the word keys it introduced. Round-tripped untouched. */
  [field: string]: unknown;
}

/** Any record a sync moves, in either direction. */
export type WireRecord = WireUserWord | WireCard | WireReview | WireLesson;

/** A stored record, parsed back out of its `data` column.
 *
 *  Trusted, and deliberately so: the column holds exactly the JSON a device
 *  pushed, this Worker is what put it there, and nothing between the two can
 *  alter it. Checking it again on the way out could only reject rows the app
 *  itself wrote, which is not a failure worth being able to have.
 */
export function storedRecord(data: string): WireRecord {
  return JSON.parse(data);
}

/* ------------------------------------------------------------------ sync -- */

/** The four tables a sync moves, in the order the Worker pages them.
 *
 *  `as const` so that the loop variable is the union below rather than
 *  `string`, which is what lets a table name index the pull and the counts
 *  without either of them widening to an open record.
 */
export const SYNC_TABLES = ['words', 'cards', 'reviews', 'lessons'] as const;

/** One of the four synced tables, and a key of both `SyncPullWire` and the
 *  pushed-row counts. */
export type SyncTable = (typeof SYNC_TABLES)[number];

/** What a device says it has that the server has not seen. Mirrors the app's
 *  `SyncPush`, except that every table is optional: the app always sends all
 *  four, and the Worker has always treated a missing one as empty rather than
 *  as an error. */
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

/** The push half of a sync body, with all four tables present as arrays.
 *
 *  Normalising here is what lets the handler go on writing `push.words || []`
 *  and `push.words?.length || 0` and be sure the two agree: the count that
 *  reserves sequence numbers and the loop that spends them read the same
 *  array, so a table that arrived as something other than an array costs no
 *  sequence numbers instead of costing some and using none.
 */
export function syncPush(value: unknown): SyncPushWire {
  const push: JsonRecord = isJsonRecord(value) ? value : {};
  /* The elements themselves are taken on trust: the Worker reads no more of a
     pushed record than its key and its timestamp, and the app is the only
     thing that writes one. A table that arrived as something other than an
     array is no rows, not an error, exactly as a missing one always was. */
  return {
    words: Array.isArray(push.words) ? push.words : [],
    cards: Array.isArray(push.cards) ? push.cards : [],
    reviews: Array.isArray(push.reviews) ? push.reviews : [],
    lessons: Array.isArray(push.lessons) ? push.lessons : [],
  };
}

/** The words a `POST /v1/words` body carries, however it was shaped.
 *
 *  A bare array and `{ words: [...] }` are both accepted, because the first
 *  clients sent the array and the endpoint has never stopped taking it.
 *  Anything else is no words, which answers `{ written: 0 }`.
 */
export function incomingWords(body: unknown): WireUserWord[] {
  if (Array.isArray(body)) return body;
  if (isJsonRecord(body) && Array.isArray(body.words)) return body.words;
  return [];
}

/** The body of `POST /v1/sync`. */
export interface SyncRequestBody {
  /** The sequence the device already has everything up to. Coerced with
   *  `Number()`, so a string or a missing value reads as 0 and the device is
   *  sent the whole account — which is exactly what a fresh device wants. */
  since?: unknown;
  /** The rows to write. Anything that is not an object is treated as no push
   *  at all. */
  push?: unknown;
}

/** What the server sends back: everything past the device's cursor, one page
 *  of each table at a time.
 *
 *  Where the app's `SyncPull` names a type per table, all four share
 *  `WireRecord[]` here. That is honest about what this code does: the rows are
 *  the JSON the devices pushed, parsed and handed straight on, and the Worker
 *  has no opinion about which of the four shapes it is passing.
 */
export type SyncPullWire = { [table in SyncTable]?: WireRecord[] };

/** One round trip's answer. Mirrors the app's `SyncResponse`. */
export interface SyncResponseBody {
  /** The newest sequence the device now has *all of*. Where a table filled its
   *  page there may be more behind it, so this stops at that page's last row
   *  rather than at the account's current sequence. */
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
  /** Where to send the code. Normalised and then shape-checked, so a typo
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

/** The device name a body asked for, or the fallback.
 *
 *  The name is the one body field the Worker does not coerce: it goes straight
 *  into `name.slice(0, 60)`. Requiring a non-empty string here keeps the empty
 *  string falling back the way `body.name || 'device'` always did, and turns
 *  the one case the old code could not survive — a name that arrived as a
 *  number or an object — into the same fallback rather than a 500.
 */
export function deviceName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
