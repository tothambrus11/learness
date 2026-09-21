/** Opening and closing a grammar bit: the learner's one act on one.
 *
 *  The record is a BitState (model.ts), last-write-wins with a tombstone
 *  like a word, so closing is a write too and travels. Whoever is showing
 *  what is open can be told — the Grammar screen after its own tap, the home
 *  line — and the sitting reads the store when it is dealt.
 */
import { allBits, putBit } from '../db.js';
import { notify } from '../diagnostics.js';
import { BIT_V } from '../model.js';
import { nowMs } from '../units.js';

const listeners = new Set<(id: string) => void>();

/** Be told when a bit is opened or closed here. Returns the unsubscribe. */
export function onBitsChanged(fn: (id: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Open a bit: from now on its rule may be asked. Opening one already open
 *  keeps its first opening, so the date the learner started is kept. */
export async function openBit(id: string): Promise<void> {
  const was = (await allBits()).find((b) => b.id === id);
  const now = nowMs();
  await putBit({
    id, openedAt: was && !was.deleted ? was.openedAt : now, updatedAt: now, v: BIT_V,
  });
  notify(listeners, id, 'bits', 'a listener failed on opening');
}

/** Close a bit: a tombstone, so the closing reaches every device. The rule
 *  is no longer asked; what was learnt stays in the log. */
export async function closeBit(id: string): Promise<void> {
  const was = (await allBits()).find((b) => b.id === id);
  const now = nowMs();
  await putBit({ id, openedAt: was?.openedAt ?? now, updatedAt: now, deleted: true, v: BIT_V });
  notify(listeners, id, 'bits', 'a listener failed on closing');
}
