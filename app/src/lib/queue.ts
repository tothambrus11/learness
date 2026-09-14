/** A sitting that survives a reload.
 *
 *  A session used to be assembled fresh on every mount, so refreshing the page
 *  mid-sitting dealt a different card: the queue is shuffled, the allowance is
 *  recomputed, and nothing remembered where you were. On a phone that happens
 *  by accident — the browser reclaims a backgrounded tab — and it costs the
 *  card you were in the middle of thinking about.
 *
 *  So the queue is written down: card ids, the position in them, and what has
 *  been answered so far. Ids, not words: the word behind an id is looked up
 *  again on every load, which is why correcting a word's English now shows on
 *  the very next card rather than the next sitting.
 *
 *  Everything here is pure. session.ts does the storing.
 */
import { isChannel, isRung, trustWordKey } from './keys.js';
import type { CardId, Channel, Rung, WordKey } from './keys.js';
import type { LadderCard, StudyWord } from './model.js';
import type { Check } from './check.js';
import type { Grade } from './scheduler.js';
import { nowMs } from './units.js';
import type { Millis } from './units.js';

/** One card of a sitting, with the word it is about looked up.
 *
 *  Always a card with a place on the ladder: a queue is built from active
 *  cards, and a written-down one is rebuilt through `parseCardId`, which
 *  rejects an id that does not name a real channel and rung. */
export interface StudyItem {
  card: LadderCard;
  word: StudyWord;
}

/** What a sitting has achieved so far. Shown at the end, and carried across a
 *  reload so the count does not start again. */
export interface Tally {
  answered: number;
  right: number;
  learned: number;
  promoted: number;
  heard: number;
}

/** One answered card, as the screen keeps it for looking back. */
export interface HistoryEntry {
  item: StudyItem;
  rating: Grade;
  typed: string;
  verdict: Check | null;
}

/** The same row, written down: the card by id, not the card. */
export interface SavedHistoryRow {
  id: CardId;
  rating: Grade;
  typed: string;
  verdict: Check | null;
}

/** A sitting as it is stored between loads.
 *
 *  A row written before the walk was removed carries a `walk` flag as well.
 *  Nothing reads it: there is one kind of sitting now, and an extra field in
 *  a stored object is not an error. */
export interface SavedSitting {
  ids: CardId[];
  /** Position in `ids`: the card to deal next. */
  i: number;
  /** The local day it was dealt on. */
  day: Millis;
  done: Partial<Tally>;
  history: SavedHistoryRow[];
  /** When it was last written. */
  at: Millis;
}

/** A card id is "<lemma>|<pos>|<channel>|<rung>", and the key itself contains
 *  a bar, so it is read from the right. Anything that does not name a real
 *  channel and rung is not a card id, however many bars it has. */
export function parseCardId(
  id: string | null | undefined,
): { key: WordKey; channel: Channel; rung: Rung } | null {
  const parts = (id ?? '').split('|');
  if (parts.length < 4) return null;
  const rung = parts.pop();
  const channel = parts.pop();
  if (!isChannel(channel) || !isRung(rung)) return null;
  return { key: trustWordKey(parts.join('|')), channel, rung };
}

/** How long a queue nobody has answered a card from is still worth carrying
 *  on with. A dealt queue is a snapshot of what was due when it was built, and
 *  cards fall due all day; after a couple of hours away, one you never started
 *  is better rebuilt than resumed. Once it has been started it is yours until
 *  it is finished, however long the interruption. */
export const UNTOUCHED_FOR = 2 * 3600 * 1000;

/** Is a written-down sitting still the one to carry on with?
 *
 *  The same day, since the scheduler's day has turned over and yesterday's due
 *  pile is not today's. It used to have to be the same *mode* as well, back
 *  when a walk was a queue of its own.
 */
export function resumable(
  /* Whatever was in storage, which is not necessarily a sitting: this is the
     function that decides. Hence a partial, and hence every field below being
     checked rather than assumed. */
  saved: Partial<SavedSitting> | null | undefined,
  { dayStart = 0 as Millis, now = nowMs() }:
    { dayStart?: Millis; now?: Millis } = {},
): boolean {
  if (!saved || !Array.isArray(saved.ids) || !saved.ids.length) return false;
  if (!saved.day || saved.day !== dayStart) return false;
  const at = saved.i ?? 0;
  if (at >= saved.ids.length) return false;
  return at > 0 || now - (saved.at ?? 0) < UNTOUCHED_FOR;
}

/** What the study screen writes down after every answer. Kept small: the
 *  queue is ids, and history is what was typed, not the card. */
export function snapshot({ items, i, day, done, history }: {
  items: readonly StudyItem[];
  i: number;
  day: Millis;
  done: Partial<Tally>;
  history: readonly HistoryEntry[];
}): SavedSitting {
  return {
    ids: items.map((it) => it.card.id),
    i,
    day,
    done: { ...done },
    history: history.map((h) => ({ id: h.item.card.id, rating: h.rating, typed: h.typed,
      verdict: h.verdict })),
    at: nowMs(),
  };
}

/** The other direction: history rows back into the items they refer to.
 *
 *  A card can appear twice in one queue — an "Again" puts it back — so a row is
 *  matched against the item at its own position first, and only then by id.
 */
export function restoreHistory(
  /* Rows as they come back from storage, which may be from an older shape of
     this record: everything but the card and the answer is filled in. A row
     with no answer in it is not history and is dropped. */
  rows: readonly Partial<SavedHistoryRow>[] = [],
  items: readonly StudyItem[] = [],
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  rows.forEach((row, at) => {
    const item = items[at]?.card.id === row.id
      ? items[at] : items.find((it) => it.card.id === row.id);
    if (!item || row.rating === undefined) return;
    out.push({ item, rating: row.rating, typed: row.typed ?? '', verdict: row.verdict ?? null });
  });
  return out;
}
