/** Every word you have met, ranked by how well you know it.
 *
 *  "How well" is the written card's stability: FSRS's estimate, in days, of
 *  how long the memory lasts before recall drops to 90%. It is the one number
 *  that moves with every answer and means the same thing for every word. The
 *  heard channel is shown beside it, since a word you read easily may still be
 *  one you cannot catch.
 */
import { CHANNELS, RUNGS } from './keys.js';
import type { Channel, Rung, WordKey } from './keys.js';
import type { Gender, LadderCard, Review, StoredCard, StudyWord } from './model.js';
import { isActive } from './ladder.js';
import { isMature, State } from './scheduler.js';
import { atMs, DAY_MS, whenMs } from './units.js';
import type { Millis } from './units.js';

/** How one channel of one word stands. Everything the cards screen shows
 *  about a card, worked out once. */
export interface ChannelView {
  channel: Channel;
  rung: Rung;
  /** How many rungs up this channel the word has come. */
  climbed: number;
  state: State;
  mature: boolean;
  /** FSRS's memory half-life, in days. */
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  leech: boolean;
  /** Days until due; negative is overdue. */
  dueIn: number;
  lastReview: Millis | 0;
  /** Share of this card's answers that were Good or better, or null. */
  accuracy: number | null;
  answers: number;
}

/** One word, with each channel it has open. */
export interface WordRow {
  key: WordKey;
  fr: string;
  en: string;
  gender: Gender;
  lvl: number;
  user: boolean;
  channels: Partial<Record<Channel, ChannelView>>;
  /** The written channel's stability: the word's headline number. */
  strength: number;
  lapses: number;
  lastReview: number;
  dueIn: number;
  label: string;
  open: Channel[];
}

export type SortKey = 'weakest' | 'strongest' | 'recent' | 'lapses' | 'due';

export const SORTS: Record<SortKey, string> = {
  weakest: 'weakest first',
  strongest: 'strongest first',
  recent: 'last seen',
  lapses: 'most forgotten',
  due: 'due soonest',
};

/** One word per rung, for the chips. */
export const SHORT: Record<string, string> = {
  recognise: 'read', say: 'say', write: 'write', use: 'use', hear: 'hear', dictate: 'dictate',
};

function describe(card: LadderCard, log: readonly Review[], now: Date): ChannelView {
  const total = log.length;
  const right = log.filter((r) => r.rating >= 3).length;
  const dueIn = (whenMs(card.due) - atMs(now)) / DAY_MS;
  return {
    channel: card.channel,
    rung: card.rung,
    climbed: RUNGS[card.channel].indexOf(card.rung),
    state: card.state,
    mature: isMature(card),
    stability: card.stability ?? 0,
    difficulty: card.difficulty ?? 0,
    reps: card.reps ?? 0,
    lapses: card.lapses ?? 0,
    leech: !!card.leech,
    dueIn,                                   /* days; negative is overdue */
    lastReview: card.last_review ? whenMs(card.last_review) : 0,
    accuracy: total ? right / total : null,
    answers: total,
  };
}

export function stateLabel(d: Pick<ChannelView, 'state' | 'reps' | 'mature'>): string {
  if (d.state === State.New || d.reps === 0) return 'new';
  if (d.mature) return 'known';
  if (d.state === State.Relearning) return 'relearning';
  if (d.state === State.Learning) return 'learning';
  return 'review';
}

/** One row per word, with each channel's active rung and the word's headline.
 *  Retired rungs are folded in only as history: their lapses count against
 *  the word, the rest is the card that is live. */
export function summarise({ cards, reviews, wordOf, now = new Date() }: {
  cards: readonly StoredCard[];
  reviews: readonly Review[];
  wordOf: (key: WordKey) => StudyWord | undefined | null;
  now?: Date;
}): WordRow[] {
  const byCard = new Map<string, Review[]>();
  for (const r of reviews) {
    const log = byCard.get(r.id) ?? [];
    log.push(r);
    byCard.set(r.id, log);
  }
  const rows = new Map<WordKey, WordRow>();
  const retiredLapses = new Map<WordKey, number>();
  for (const c of cards) {
    if (!c.channel) continue;
    let row = rows.get(c.key);
    if (!row) {
      const w = wordOf(c.key);
      row = {
        key: c.key, fr: w?.fr ?? c.key.split('|')[0] ?? c.key, en: w?.en?.[0] ?? '',
        gender: w?.gender ?? '', lvl: w?.lvl ?? 0, user: !!w?.user, channels: {},
        strength: 0, lapses: 0, lastReview: 0, dueIn: Infinity, label: 'new', open: [],
      };
      rows.set(c.key, row);
    }
    if (isActive(c)) {
      row.channels[c.channel] = describe(c, byCard.get(c.id) ?? [], now);
    } else {
      retiredLapses.set(c.key, (retiredLapses.get(c.key) ?? 0) + (c.lapses ?? 0));
    }
  }
  for (const row of rows.values()) {
    const live = Object.values(row.channels);
    const written = row.channels.written;
    row.strength = written?.stability ?? 0;
    row.lapses = live.reduce((n, d) => n + d.lapses, 0) + (retiredLapses.get(row.key) ?? 0);
    row.lastReview = Math.max(0, ...live.map((d) => d.lastReview));
    row.dueIn = live.length ? Math.min(...live.map((d) => d.dueIn)) : Infinity;
    row.label = written ? stateLabel(written) : 'new';
    row.open = CHANNELS.filter((ch) => row.channels[ch]);
  }
  return [...rows.values()];
}

export function sortRows(rows: readonly WordRow[], by: SortKey | string): WordRow[] {
  const list = [...rows];
  const cmp: Record<string, (a: WordRow, b: WordRow) => number> = {
    weakest: (a, b) => a.strength - b.strength || b.lapses - a.lapses || a.fr.localeCompare(b.fr),
    strongest: (a, b) => b.strength - a.strength || a.fr.localeCompare(b.fr),
    recent: (a, b) => b.lastReview - a.lastReview,
    lapses: (a, b) => b.lapses - a.lapses || a.strength - b.strength,
    due: (a, b) => a.dueIn - b.dueIn,
  };
  return list.sort(cmp[by] ?? ((a, b) => a.strength - b.strength));
}

/** Counts for the header: how the words you have met are spread. */
export function tally(rows: readonly WordRow[]): Record<string, number> {
  const out: Record<string, number> = { new: 0, learning: 0, review: 0, known: 0 };
  for (const r of rows) {
    const l = r.label === 'relearning' ? 'learning' : r.label;
    out[l] = (out[l] ?? 0) + 1;
  }
  return out;
}

/** 0..1 for a bar: log scale, so a week and a year are both visible. */
export const strengthBar = (days: number): number => Math.min(1, Math.log10(1 + Math.max(0, days)) / Math.log10(366));

export function dueText(days: number): string {
  if (!Number.isFinite(days)) return '';
  if (days < -1) return `${Math.round(-days)} d overdue`;
  if (days < 0) return 'due now';
  if (days < 1) return 'due today';
  if (days < 30) return `due in ${Math.round(days)} d`;
  if (days < 365) return `due in ${Math.round(days / 30)} mo`;
  return `due in ${(days / 365).toFixed(1)} y`;
}
