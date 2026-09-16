/** D1, for the tests: the same SQL, run by SQLite itself.
 *
 *  D1 is SQLite behind a small asynchronous API — prepare, bind, first, all,
 *  run, batch — and Node ships SQLite, so the tests need no stand-in for the
 *  queries: the statements the Worker writes run against a real database
 *  with the real migrations applied. What is faked here is only the shape of
 *  the API, and a bug in the SQL fails a test rather than a deploy.
 *
 *  Only what the Worker uses is here. A method it does not call is not
 *  implemented, and the cast at the bottom says so.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** D1 binds booleans and undefined where SQLite wants integers and null. */
const sqlValue = (v: unknown): SQLInputValue => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  throw new TypeError(`cannot bind a ${typeof v} into SQL`);
};

const returnsRows = (sql: string): boolean =>
  /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

class Statement {
  private params: SQLInputValue[] = [];

  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}

  bind(...values: unknown[]): Statement {
    const next = new Statement(this.db, this.sql);
    next.params = values.map(sqlValue);
    return next;
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = returnsRows(this.sql)
      ? (this.db.prepare(this.sql).all(...this.params) as T[])
      : (this.db.prepare(this.sql).run(...this.params), [] as T[]);
    return { results, success: true, meta: meta(0) };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (returnsRows(this.sql)) return this.all<T>();
    const r = this.db.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: meta(Number(r.changes), Number(r.lastInsertRowid)) };
  }
}

const meta = (changes: number, lastRowId = 0): D1Result['meta'] => ({
  duration: 0, size_after: 0, rows_read: 0, rows_written: changes, last_row_id: lastRowId,
  changed_db: changes > 0, changes,
});

/** A database with every migration applied, in order, as `wrangler d1
 *  migrations apply` would. */
export function testDatabase(): { d1: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  const d1 = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    /* D1 runs a batch in one transaction; so does this. */
    batch: async (statements: Statement[]) => {
      sqlite.exec('BEGIN');
      try {
        const out: D1Result[] = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    exec: async (sql: string) => { sqlite.exec(sql); return { count: 1, duration: 0 }; },
  };
  return { d1: d1 as unknown as D1Database, sqlite };
}
