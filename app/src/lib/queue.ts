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
import type { AttemptPart, LadderCard, RuleCard, StudyWord } from './model.js';
import type { Check } from './check.js';
import type { Instance } from './grammar/instance.js';
import type { Grade } from './scheduler.js';
import { nowMs } from './units.js';
import type { Millis } from './units.js';

/** One card of a sitting about a word, with the word looked up.
 *
 *  Always a card with a place on the ladder: a queue is built from active
 *  cards, and a written-down one is rebuilt through `parseCardId`, which
 *  rejects an id that does not name a real channel and rung. */
export interface WordItem {
  kind: 'word';
  card: LadderCard;
  word: StudyWord;
  /** The tenses a form card may ask in this sitting: the learner's open
   *  bits (grammar/gate.ts), resolved when the sitting is dealt and carried
   *  on the item so the face, the clip and the keys agree. Absent means
   *  every core tense — the fixtures, and a table read on the word's own
   *  page — which no sitting ever leaves absent. */
  tenses?: readonly string[];
}

/** One grammar exercise of a sitting: the rule's card it is dealt for, and
 *  the instance made for it (grammar/instance.ts). The card may be one no
 *  answer has written yet — a rule asked for the first time — as a word's
 *  fresh card may be. */
export interface RuleItem {
  kind: 'rule';
  card: RuleCard;
  instance: Instance;
}

/** What a sitting deals: a word's card, or a grammar exercise among them.
 *  Every reader narrows on `kind`; a rule item has no word, no clip and no
 *  rung, and what it shows is its instance. */
export type StudyItem = WordItem | RuleItem;

/** The identity a sitting knows an item by: the card's id for a word, the
 *  instance's for a rule — what the day's record writes down. */
export const itemId = (item: StudyItem): string =>
  item.kind === 'word' ? item.card.id : item.instance.id;

/** The word an item is about, or null for a rule item — the one narrowing
 *  every reader of a sitting's item makes, named once. */
export const wordOf = (item: StudyItem | null | undefined): StudyWord | null =>
  (item?.kind === 'word' ? item.word : null);
/** The rung a word item is on, or null for a rule item, which has none. */
export const rungOf = (item: StudyItem | null | undefined): Rung | null =>
  (item?.kind === 'word' ? item.card.rung : null);
/** The key of the word an item is about, or null for a rule item. */
export const keyOf = (item: StudyItem | null | undefined): WordKey | null =>
  (item?.kind === 'word' ? item.card.key : null);

/** An item in one line, for a bug report: which card or exercise, which
 *  way up, and what was typed or tapped into it and how that was judged.
 *  Ids, not words — the id names the word, the rung and the rule — and the
 *  learner's answer, since a report about a verdict is a report about an
 *  answer. Nothing here is shown to the learner; it goes into the issue
 *  the bug button opens (#98). */
export function describeItem(item: StudyItem, {
  revealed, typed = '', verdict = null, cells = [],
}: {
  revealed: boolean;
  typed?: string;
  verdict?: Check | null;
  /** An exercise's cells as filled, in its order. */
  cells?: readonly string[];
}): string {
  const parts = item.kind === 'word'
    ? [`card ${item.card.id}`]
    : [`exercise ${item.instance.id}`, `${item.instance.face} face for ${item.instance.rule}`];
  parts.push(revealed ? 'turned' : 'face down');
  const answer = item.kind === 'word' ? typed : cells.filter(Boolean).join(' / ');
  if (answer) parts.push(`answered “${answer}”`);
  if (verdict) parts.push(verdict.verdict);
  return parts.join(' · ');
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
  /** On a rule item: every cell as answered, with what was typed in it and
   *  whether it was right — what a look-back shows, since the exercise has
   *  no one answer. */
  parts?: AttemptPart[];
}

/** The same row, written down: the card by id, not the card.
 *
 *  A row from before rule items has no `kind` and its id is a card id; a
 *  rule's row says so, and its id is the instance's. `restoreHistory` reads
 *  both, so a day begun on the old shape carries on. */
export interface SavedHistoryRow {
  kind?: 'word' | 'rule';
  id: CardId | string;
  rating: Grade;
  typed: string;
  verdict: Check | null;
  parts?: AttemptPart[];
}

/** What the app remembers about a day between opens of the study screen: the
 *  answers given, by card id, and the tally. Not the queue and not a position
 *  — both are asked for again on every open. */
export interface DayRecord {
  /** The start of the day it is about — `dayStart` (progress.ts), the hour
   *  the learner's day turns. Any other day, it is nothing. */
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
    history: history.map((h) => ({
      kind: h.item.kind, id: itemId(h.item), rating: h.rating, typed: h.typed, verdict: h.verdict,
      ...(h.parts ? { parts: h.parts } : {}),
    })),
    at: nowMs(),
  };
}

/** Rows back into entries, by id alone: the card an answer was about is
 *  looked up, never taken from a position in a queue that no longer exists.
 *  A row whose card no longer resolves, or that carries no rating, is dropped
 *  rather than guessed at. A rule's row resolves to a rule item and a
 *  word's to a word item, whatever the row says it is: the id is what the
 *  caller resolved, and a row from before rule items says nothing. */
export function restoreHistory(
  /* Rows as they come back from storage, which may be from an older shape of
     this record: everything but the card and the answer is filled in. */
  rows: readonly Partial<SavedHistoryRow>[] = [],
  resolved: ReadonlyMap<string, StudyItem> = new Map(),
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const row of rows) {
    const item = row.id ? resolved.get(row.id) : undefined;
    if (!item || row.rating === undefined) continue;
    if ((row.kind ?? 'word') !== item.kind) continue;
    out.push({
      item, rating: row.rating, typed: row.typed ?? '', verdict: row.verdict ?? null,
      ...(item.kind === 'rule' && row.parts ? { parts: row.parts } : {}),
    });
  }
  return out;
}
