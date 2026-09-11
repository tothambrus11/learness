/** A sitting that survives a reload: the stored queue, whether it may still be
 *  resumed, and the conversions between it and the live state. Everything here
 *  is pure; session.ts does the storing. */
import { RUNGS } from './keys';
import type {
  CardId,
  Channel,
  Rung,
  SittingHistoryEntry,
  SittingHistoryRow,
  SittingItem,
  SittingSnapshot,
  SittingTally,
  WordKey,
} from './types';

/** A card id taken apart into the three things it names. */
export interface ParsedCardId {
  /** The word, which may itself contain a bar. */
  key: WordKey;
  /** Which ladder. */
  channel: Channel;
  /** Which rung of it. */
  rung: Rung;
}

/** Whether a string names a ladder this app knows. */
const isChannel = (value: string): value is Channel => value === 'written' || value === 'heard';

/** Whether a string names a rung of the given ladder. */
const isRung = (channel: Channel, value: string): value is Rung =>
  (RUNGS[channel] as readonly string[]).includes(value);

/** A card id — `"<lemma>|<pos>|<channel>|<rung>"` — taken apart, or null for
 *  anything that is not one: too few parts, or a channel or rung this version
 *  does not have. The key itself contains a bar, so the id is read from the
 *  right. */
export function parseCardId(id: string | null | undefined): ParsedCardId | null {
  const parts = (id ?? '').split('|');
  if (parts.length < 4) return null;
  const rung = parts.pop();
  const channel = parts.pop();
  if (rung === undefined || channel === undefined) return null;
  if (!isChannel(channel) || !isRung(channel, rung)) return null;
  return { key: parts.join('|'), channel, rung };
}

/** Milliseconds a queue with no answer in it may sit before it stops being
 *  worth carrying on with. Once started, a queue is resumable however long the
 *  interruption. */
export const UNTOUCHED_FOR = 2 * 3600 * 1000;

/** What deciding to resume depends on, beyond the snapshot itself. */
export interface ResumeContext {
  /** Local midnight of today, as `dayStart()` computes it. */
  dayStart?: number;
  /** The moment to measure staleness from. */
  now?: number;
}

/** True when a written-down sitting is still the one to carry on with: dealt
 *  today, not yet finished, and either already started or written down less
 *  than `UNTOUCHED_FOR` ago. A queue left by the walking mode is never
 *  resumed. */
export function resumable(
  saved: SittingSnapshot | null | undefined,
  { dayStart = 0, now = Date.now() }: ResumeContext = {},
): boolean {
  if (!saved || !Array.isArray(saved.ids) || !saved.ids.length) return false;
  if (saved.walk) return false;
  if (!saved.day || saved.day !== dayStart) return false;
  if (saved.i >= saved.ids.length) return false;
  return saved.i > 0 || now - (saved.at ?? 0) < UNTOUCHED_FOR;
}

/** A sitting that has achieved nothing yet. Every snapshot is written over
 *  this, so a stored tally is always complete and a screen reading one back
 *  never has to guard a missing count. */
const NO_TALLY: SittingTally = { answered: 0, right: 0, learned: 0, promoted: 0, heard: 0 };

/** The live state of a sitting, as the study screen holds it. */
export interface SittingState {
  /** The queue, cards and words together. */
  items: readonly SittingItem[];
  /** How far through it the learner is. */
  i: number;
  /** Local midnight of the day it was dealt. */
  day: number;
  /** The running tally. */
  done: Partial<SittingTally>;
  /** What has been answered, newest last. */
  history: readonly SittingHistoryEntry[];
}

/** The live state written down: the queue as ids, and history as what was
 *  typed rather than the card it was typed on. */
export function snapshot({ items, i, day, done, history }: SittingState): SittingSnapshot {
  return {
    ids: items.map((it) => it.card.id),
    i,
    day,
    done: { ...NO_TALLY, ...done },
    history: history.map((h) => ({
      id: h.item.card.id,
      rating: h.rating,
      typed: h.typed,
      verdict: h.verdict,
    })),
    at: Date.now(),
  };
}

/** The item a history row was about: the one at the row's own position when
 *  that is the right card, else the first card with the same id. Position is
 *  tried first because an "Again" can put one card in the queue twice. */
const itemFor = (
  items: readonly SittingItem[],
  at: number,
  id: CardId,
): SittingItem | undefined =>
  items[at]?.card.id === id ? items[at] : items.find((it) => it.card.id === id);

/** The other direction: history rows back onto the items they refer to. A row
 *  is matched against the item at its own position first and only then by id,
 *  and one whose card is no longer in the queue is dropped. */
export function restoreHistory(
  rows: readonly SittingHistoryRow[] = [],
  items: readonly SittingItem[] = [],
): SittingHistoryEntry[] {
  const out: SittingHistoryEntry[] = [];
  rows.forEach((row, at) => {
    const item = itemFor(items, at, row.id);
    if (item) {
      out.push({
        item,
        rating: row.rating,
        typed: row.typed ?? '',
        verdict: row.verdict ?? null,
      });
    }
  });
  return out;
}

/** Cards added to a queue already dealt — the learner's own words — inserted
 *  at position `i`, so the next card is one of them and nothing already
 *  answered moves. Cards already in the queue are never added twice, and
 *  `items` itself comes back when there is nothing to add, so a caller can
 *  tell by identity whether the queue changed. */
export function topUp(
  items: readonly SittingItem[],
  i: number,
  extra: readonly SittingItem[],
): SittingItem[] | readonly SittingItem[] {
  if (!extra.length) return items;
  const queued = new Set<CardId>(items.map((it) => it.card.id));
  const fresh = extra.filter((it) => !queued.has(it.card.id));
  if (!fresh.length) return items;
  return [...items.slice(0, i), ...fresh, ...items.slice(i)];
}
