/** The migrations, as the pipeline applies them.
 *
 *  `wrangler d1 migrations apply` runs each file in `migrations/` once, in
 *  name order, and writes its name in a ledger in the database. That makes
 *  two promises the files must keep: the order is the numbering, with no
 *  gaps and no two files sharing a number; and a file is applied to a
 *  database that already has data — so a migration from here on adds and
 *  never drops. `0002` drops and recreates every table, which was right on
 *  the day (they were empty) and would empty an account today; it is the
 *  reason a migration is never `d1 execute`d by hand, and the reason this
 *  test refuses a new one like it.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '..', 'migrations');
const ROOT = resolve(HERE, '..', '..');

const files = (): string[] => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/** wrangler.jsonc without its comments, enough for JSON.parse. */
function wranglerConfig(): { d1_databases?: { database_name: string; migrations_dir?: string }[] } {
  const raw = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw) as ReturnType<typeof wranglerConfig>;
}

test('the migrations are numbered in order, with no gap and no number twice', () => {
  const names = files();
  assert.ok(names.length >= 6);
  names.forEach((name, i) => {
    assert.match(name, /^\d{4}_[a-z0-9_]+\.sql$/, `${name} is named as wrangler sorts`);
    assert.equal(Number(name.slice(0, 4)), i + 1, `${name} follows the one before it`);
  });
});

test('the pipeline applies the same directory the tests do', () => {
  const db = wranglerConfig().d1_databases?.find((d) => d.database_name === 'frcog');
  assert.ok(db, 'the frcog binding is in wrangler.jsonc');
  assert.equal(resolve(ROOT, db.migrations_dir ?? ''), MIGRATIONS,
    'migrations_dir points at server/migrations, or the pipeline applies nothing');
});

test('a migration written after the accounts one only adds: nothing is dropped or emptied', () => {
  /* The ledger runs a file once against a database with data in it. A file
     that drops a table drops the learner's words; a file that deletes rows
     deletes their reviews. Additive, or not at all. */
  for (const name of files().filter((f) => Number(f.slice(0, 4)) > 2)) {
    const sql = readFileSync(join(MIGRATIONS, name), 'utf8')
      .replace(/--.*$/gm, '');
    assert.doesNotMatch(sql, /\b(drop\s+table|drop\s+column|delete\s+from|truncate)\b/i,
      `${name} must be additive`);
  }
});

test('every migration applies in order to an empty database, and the tables the Worker reads exist', () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of files()) sqlite.exec(readFileSync(join(MIGRATIONS, name), 'utf8'));
  const tables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    .map((r) => r.name));
  for (const t of ['users', 'devices', 'words', 'cards', 'reviews', 'lessons', 'themes', 'counter',
    'login_codes', 'passkeys', 'oauth_clients', 'oauth_codes']) {
    assert.ok(tables.has(t), `${t} exists after the migrations`);
  }
});
