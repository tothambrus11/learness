/** The day's record, and the shapes of a sitting.
 *
 *  A sitting used to be written down whole — card ids and a position — because
 *  deriving it again dealt a different card: the reviews were shuffled and the
 *  allowance forgot what the day had met. Both are gone (plan.ts, and the
 *  day's intake read from the log), so the queue is derived on every open and
 *  only the day is remembered: what was answered, by id, and the tally. Ids,
 *  not words: the word behind an id is looked up again on every load, which is
 *  why correcting a word's English shows on the very next card rather than the
 *  next sitting.
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

/** What a day has achieved so far. Shown at the end of a sitting, and carried
 *  across every open of the study screen so the count does not start again. */
export interface Tally {
  answered: number;
  right: number;
  learned: number;
  promoted: number;
  heard: number;
}

export const EMPTY_TALLY: Tally = { answered: 0, right: 0, learned: 0, promoted: 0, heard: 0 };

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

/** What the app remembers about a day between opens of the study screen: the
 *  answers given, by card id, and the tally. Not the queue and not a position
 *  — both are asked for again on every open. */
export interface DayRecord {
  /** Local midnight of the day it is about. Any other day, it is nothing. */
  day: Millis;
  done: Tally;
  /** Oldest first. A card answered twice has two rows. */
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

/** Is whatever was in storage today's record? Every field is checked rather
 *  than assumed, since this is the function that decides what a record is,
 *  and a row of an older shape — the queue that used to be written down — is
 *  not one. */
export function sameDay(
  record: Partial<DayRecord> | null | undefined, dayStart: Millis,
): record is DayRecord {
  return !!record && record.day === dayStart
    && Array.isArray(record.history) && typeof record.done === 'object' && !!record.done;
}

/** What the study screen writes down after every answer. */
export function dayRecord({ day, done, history }: {
  day: Millis;
  done: Tally;
  history: readonly HistoryEntry[];
}): DayRecord {
  return {
    day,
    done: { ...done },
    history: history.map((h) => ({ id: h.item.card.id, rating: h.rating, typed: h.typed,
      verdict: h.verdict })),
    at: nowMs(),
  };
}

/** Rows back into entries, by id alone: the card an answer was about is
 *  looked up, never taken from a position in a queue that no longer exists.
 *  A row whose card no longer resolves, or that carries no rating, is dropped
 *  rather than guessed at. */
export function restoreHistory(
  /* Rows as they come back from storage, which may be from an older shape of
     this record: everything but the card and the answer is filled in. */
  rows: readonly Partial<SavedHistoryRow>[] = [],
  resolved: ReadonlyMap<CardId, StudyItem> = new Map(),
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const row of rows) {
    const item = row.id ? resolved.get(row.id) : undefined;
    if (!item || row.rating === undefined) continue;
    out.push({ item, rating: row.rating, typed: row.typed ?? '', verdict: row.verdict ?? null });
  }
  return out;
}
