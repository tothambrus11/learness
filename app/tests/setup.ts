/** What every test file can assume is in place: a working IndexedDB. The fake
 *  database is wiped between files, not between tests — a test that cares about
 *  starting empty says so with `resetIndexedDB()`. */

/* Two things the library reaches for that Node does not have: IndexedDB, and
   `crypto.randomUUID` on older runtimes. Both are supplied here rather than in
   each test, so a module can be imported without the importer having to know
   which globals it happens to touch at load time. */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach } from 'vitest';

/** Throws away every database and leaves an empty IndexedDB behind. */
export function resetIndexedDB(): void {
  /* Call it from a test that stores anything, so one test's cards are never
     another's. Replacing the factory wholesale is the only way to drop
     databases that a previous test left open. */
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
}

resetIndexedDB();

beforeEach(() => {
  /* A module under test may hold an open connection from the last file. The
     cheapest way to keep files independent is a fresh factory per test. */
  resetIndexedDB();
});
