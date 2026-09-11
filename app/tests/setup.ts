/** What every test file can assume is in place: a working IndexedDB, which Node
 *  does not have. Supplied here rather than in each test, so a module can be
 *  imported without the importer having to know which globals it touches at
 *  load time. */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach } from 'vitest';

/** Throws away every database and leaves an empty IndexedDB behind. Replacing
 *  the factory wholesale is the only way to drop databases that an earlier test
 *  left open. */
export function resetIndexedDB(): void {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
}

resetIndexedDB();

beforeEach(() => {
  resetIndexedDB();
});
