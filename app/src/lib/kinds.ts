/** The kinds of record that sync, named once.
 *
 *  Five kinds travel between a device and the Worker, and each used to be
 *  named in seven places — the app's push and pull shapes, its read of the
 *  store, its write-back, its notice; the Worker's counts, its five SQL
 *  templates, its pull loop — three shapes among them kept consistent by
 *  eye. Adding a kind was thirty-odd edits. Now a kind is a row here, and
 *  both sides iterate the rows: the Worker imports this file as it imports
 *  the app's other rules, and builds its SQL from `shape`.
 *
 *  Two shapes. A **record** is state with an identity, merged last-write-wins
 *  on `updatedAt`, with a tombstone where a deletion must travel rather than
 *  be undone by the device that missed it. A **log** is what happened,
 *  append-only, merged as a set union on its id. The Worker's table for a
 *  kind is named after it, keyed by `key`, and stores the record whole; the
 *  app's store is named the same. Nothing in here says what is inside a
 *  record — that is the app's business, and a field added later travels
 *  without a deployment (server/src/env.ts).
 *
 *  A kind added here needs a store in db.ts under a new version, a table
 *  under server/migrations, a wire type in env.ts, and a bump of SCHEMA
 *  (schema.ts): the compiler and the sync tests say where.
 */
interface KindBase {
  /** The store, the table, and the field of a push and a pull. */
  readonly name: string;
  /** The field that is the record's identity, and the table's key column. */
  readonly key: string;
}
export type KindSpec = KindBase & (
  /** A log kind's moment, in the record and as the table's indexed column. */
  | { readonly shape: 'log'; readonly ts: string }
  /** A record kind, and whether its deletion is a `deleted` flag that travels. */
  | { readonly shape: 'record'; readonly tombstone?: boolean }
);

export const SYNC_KINDS = [
  { name: 'words', key: 'k', shape: 'record', tombstone: true },
  { name: 'cards', key: 'id', shape: 'record' },
  { name: 'reviews', key: 'uid', shape: 'log', ts: 'ts' },
  { name: 'lessons', key: 'id', shape: 'record' },
  { name: 'themes', key: 'id', shape: 'record', tombstone: true },
] as const satisfies readonly KindSpec[];

export type SyncKind = (typeof SYNC_KINDS)[number]['name'];
/** The record kinds — every kind but the log. */
export type RecordKind = Exclude<SyncKind, 'reviews'>;

/** The rows as `KindSpec`s with their names still typed, for code that reads
 *  the optional fields: a row without `tombstone` is a row where it is
 *  absent, not a row of a type that never had it. */
export const KIND_SPECS: readonly (KindSpec & { readonly name: SyncKind })[] = SYNC_KINDS;

export const KIND_NAMES: readonly SyncKind[] = SYNC_KINDS.map((k) => k.name);

/** The row for a kind, for the code that builds SQL or reads an identity. */
export const kindOf = (name: SyncKind): KindSpec => KIND_SPECS.find((k) => k.name === name)!;

export const RECORD_KINDS: readonly RecordKind[] =
  KIND_NAMES.filter((name): name is RecordKind => kindOf(name).shape === 'record');

/** One number per kind, all zero: what a sync counts up from. */
export type Counts = Record<SyncKind, number>;
export const zeroCounts = (): Counts =>
  Object.fromEntries(KIND_NAMES.map((k) => [k, 0])) as Counts;
export const sumCounts = (counts: Counts): number =>
  KIND_NAMES.reduce((n, k) => n + counts[k], 0);
