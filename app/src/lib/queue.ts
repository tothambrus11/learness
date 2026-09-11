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

/** A card id is "<lemma>|<pos>|<channel>|<rung>", and the key itself contains
 *  a bar, so it is read from the right.
 *
 *  Null for anything that is not one: too few parts, or a channel or rung this
 *  version does not have. A card cannot be rebuilt from such an id, so the
 *  caller drops it rather than making a card on a rung that does not exist.
 */
export function parseCardId(id: string | null | undefined): ParsedCardId | null {
  const parts = (id ?? '').split('|');
  if (parts.length < 4) return null;
  const rung = parts.pop();
  const channel = parts.pop();
  if (rung === undefined || channel === undefined) return null;
  if (!isChannel(channel) || !isRung(channel, rung)) return null;
  return { key: parts.join('|'), channel, rung };
}

/** How long a queue nobody has answered a card from is still worth carrying
 *  on with. A dealt queue is a snapshot of what was due when it was built, and
 *  cards fall due all day; after a couple of hours away, one you never started
 *  is better rebuilt than resumed. Once it has been started it is yours until
 *  it is finished, however long the interruption. */
export const UNTOUCHED_FOR = 2 * 3600 * 1000;

/** What deciding to resume depends on, beyond the snapshot itself. */
export interface ResumeContext {
  /** Local midnight of today, as `dayStart()` computes it. */
  dayStart?: number;
  /** The moment to measure staleness from. */
  now?: number;
}

/** Is a written-down sitting still the one to carry on with?
 *
 *  The same day, since the scheduler's day has turned over and yesterday's due
 *  pile is not today's. A queue written down by the walk — a mode that no
 *  longer exists — is not resumed either: it was built with the typed rungs
 *  taken out.
 */
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

/** What the study screen writes down after every answer. Kept small: the
 *  queue is ids, and history is what was typed, not the card. */
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

/** The other direction: history rows back into the items they refer to.
 *
 *  A card can appear twice in one queue — an "Again" puts it back — so a row is
 *  matched against the item at its own position first, and only then by id.
 *  A row whose card is no longer in the queue is dropped rather than guessed at.
 */
export function restoreHistory(
  rows: readonly SittingHistoryRow[] = [],
  items: readonly SittingItem[] = [],
): SittingHistoryEntry[] {
  const out: SittingHistoryEntry[] = [];
  rows.forEach((row, at) => {
    const item =
      items[at]?.card.id === row.id ? items[at] : items.find((it) => it.card.id === row.id);
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

/** Cards that belong at the front of a queue already dealt: your own words,
 *  added since it was written down. They go in at the current position, so
 *  the next card is one of them, and nothing already answered moves.
 *
 *  Returns the original array untouched when there is nothing to add, so a
 *  caller can tell by identity whether the queue changed. Cards already in the
 *  queue are never added twice.
 */
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
