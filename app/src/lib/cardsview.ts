/** Every word you have met, ranked by how well you know it.
 *
 *  "How well" is the written card's stability: FSRS's estimate, in days, of
 *  how long the memory lasts before recall drops to 90%. It is the one number
 *  that moves with every answer and means the same thing for every word. The
 *  heard channel is shown beside it, since a word you read easily may still be
 *  one you cannot catch.
 */
import { CHANNELS, RUNGS } from './keys';
import { isActive } from './ladder';
import { isMature, Rating, State } from './scheduler';
import type { Card, Channel, Review, Rung, StudyWord, WordKey } from './types';

/** Milliseconds in a day, for turning a due date into days from now. */
const DAY = 86400000;

/** The orderings the list offers, as name to what the menu calls it. */
export const SORTS = {
  weakest: 'weakest first',
  strongest: 'strongest first',
  recent: 'last seen',
  lapses: 'most forgotten',
  due: 'due soonest',
} as const;

/** One of the orderings, which is what `sortRows()` takes. Anything else falls
 *  back to weakest first. */
export type SortName = keyof typeof SORTS;

/** One word per rung, for the chips. */
export const SHORT = {
  recognise: 'read',
  say: 'say',
  write: 'write',
  use: 'use',
  hear: 'hear',
  dictate: 'dictate',
} as const satisfies Record<Rung, string>;

/** One channel of one word, as the row and its detail table read it: the live
 *  card's own numbers, with the answer history folded in. */
export interface ChannelView {
  /** Which ladder this is. */
  channel: Channel;
  /** The rung the live card is on. */
  rung: Rung;
  /** How far up the ladder that rung is, counting from 0. */
  climbed: number;
  /** FSRS's state for the card: new, learning, review, relearning. */
  state: State;
  /** True once the memory is long enough to call the word known. */
  mature: boolean;
  /** The memory's half-life in days, which is the headline number. */
  stability: number;
  /** How hard FSRS finds this card, 0..10. */
  difficulty: number;
  /** Answers given to this card. */
  reps: number;
  /** Times it was forgotten after being known. */
  lapses: number;
  /** True where the lapses have passed the leech threshold. */
  leech: boolean;
  /** Days until it comes round; negative is overdue. */
  dueIn: number;
  /** Milliseconds at the last answer, or 0 for a card never answered. */
  lastReview: number;
  /** Share of the logged answers that were Good or better, or null where
   *  there are none to divide by. */
  accuracy: number | null;
  /** How many logged answers that share is over. */
  answers: number;
}

/** One card's numbers, with its own slice of the review log folded in. `log`
 *  is every row for this card; `now` is what "due in" is measured from. */
function describe(card: Card, log: readonly Pick<Review, 'rating'>[], now: Date): ChannelView {
  const total = log.length;
  const right = log.filter((r) => r.rating >= Rating.Good).length;
  const dueIn = (new Date(card.due).getTime() - now.getTime()) / DAY;
  /* RUNGS narrows to one channel's own tuple; the search is over rungs at large. */
  const rungs: readonly Rung[] = RUNGS[card.channel];
  return {
    channel: card.channel,
    rung: card.rung,
    climbed: rungs.indexOf(card.rung),
    state: card.state,
    mature: isMature(card),
    stability: card.stability ?? 0,
    difficulty: card.difficulty ?? 0,
    reps: card.reps ?? 0,
    lapses: card.lapses ?? 0,
    leech: !!card.leech,
    dueIn /* days; negative is overdue */,
    lastReview: card.last_review ? new Date(card.last_review).getTime() : 0,
    accuracy: total ? right / total : null,
    answers: total,
  };
}

/** What a word's progress is called on screen. `relearning` is a state of its
 *  own on a card but is counted as learning in the tally. */
export type StateLabel = 'new' | 'learning' | 'relearning' | 'review' | 'known';

/** The one word for where a card stands. A card with no answers yet reads as
 *  new whatever FSRS says, and a mature one reads as known however it got
 *  there. */
export function stateLabel(d: Pick<ChannelView, 'state' | 'reps' | 'mature'>): StateLabel {
  if (d.state === State.New || d.reps === 0) return 'new';
  if (d.mature) return 'known';
  if (d.state === State.Relearning) return 'relearning';
  if (d.state === State.Learning) return 'learning';
  return 'review';
}

/** One word as the list shows it: what it is, how far each channel has got,
 *  and the headline numbers the row is sorted and drawn by. */
export interface CardRow {
  /** The word's identity, and the row's key. */
  key: WordKey;
  /** The French as it is shown, article and all. */
  fr: string;
  /** The first translation, or `''` — one line, not the list. */
  en: string;
  /** `m` | `f` | `mf` | `''`, for colouring the article. */
  gender: string;
  /** Which level of 100 words it falls in; 0 for a word of your own. */
  lvl: number;
  /** True where the word came from your own list. */
  user: boolean;
  /** The live card of each channel. A channel the word has not started is
   *  absent rather than empty, so `open` — not this — is what says which ones
   *  are really there; reading one that is not listed there gives nothing. */
  channels: Record<Channel, ChannelView>;
  /** The written card's stability in days, which is what "how well you know
   *  it" means here. 0 where the word has no written card. */
  strength: number;
  /** Times this word has been forgotten, retired rungs included. */
  lapses: number;
  /** Milliseconds at the most recent answer on any channel; 0 for none. */
  lastReview: number;
  /** Days until the soonest of its channels comes round; Infinity where none
   *  is scheduled. */
  dueIn: number;
  /** Where the word stands, which is where its written card stands. */
  label: StateLabel;
  /** The channels that have a live card, in ladder order. */
  open: Channel[];
}

/** What `summarise()` needs to build the list. */
export interface SummaryInput {
  /** Every card of every word, retired rungs included. */
  cards: readonly Card[];
  /** The review log. Only the card each row was for and what was pressed are
   *  read, so a caller may hand in rows trimmed to that. */
  reviews: readonly Pick<Review, 'id' | 'rating'>[];
  /** The word behind a key, for its spelling and level. A key with no word
   *  still gets a row, labelled with the lemma out of the key itself. */
  wordOf: (key: WordKey) => StudyWord | null | undefined;
  /** What "due in" is measured from. */
  now?: Date;
}

/** One row per word, with each channel's active rung and the word's headline.
 *  Retired rungs are folded in only as history: their lapses count against
 *  the word, the rest is the card that is live. */
export function summarise({
  cards,
  reviews,
  wordOf,
  now = new Date(),
}: SummaryInput): CardRow[] {
  const byCard = new Map<string, Pick<Review, 'id' | 'rating'>[]>();
  for (const r of reviews) {
    if (!byCard.has(r.id)) byCard.set(r.id, []);
    byCard.get(r.id)?.push(r);
  }
  /* The headline fields are filled by the second pass, once every card of a
     word has been seen; until then a row is only its identity. */
  const rows = new Map<WordKey, CardRow>();
  const retiredLapses = new Map<WordKey, number>();
  for (const c of cards) {
    if (!c.channel) continue;
    if (!rows.has(c.key)) {
      const w = wordOf(c.key);
      rows.set(c.key, {
        key: c.key,
        fr: w?.fr ?? c.key.split('|')[0],
        en: w?.en?.[0] ?? '',
        gender: w?.gender ?? '',
        lvl: w?.lvl ?? 0,
        user: !!w?.user,
        channels: {},
      } as CardRow);
    }
    if (isActive(c)) {
      const row = rows.get(c.key);
      if (row) row.channels[c.channel] = describe(c, byCard.get(c.id) ?? [], now);
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

/** How two rows are ordered: negative where `a` comes first, as `sort` wants
 *  it. */
type RowCompare = (a: CardRow, b: CardRow) => number;

/** The rows in the order asked for, as a copy. Ties fall back to something
 *  stable so the list does not shuffle under a rerender. */
export function sortRows(rows: readonly CardRow[], by: SortName): CardRow[] {
  const list = [...rows];
  const cmps: Record<SortName, RowCompare> = {
    weakest: (a, b) =>
      a.strength - b.strength || b.lapses - a.lapses || a.fr.localeCompare(b.fr),
    strongest: (a, b) => b.strength - a.strength || a.fr.localeCompare(b.fr),
    recent: (a, b) => b.lastReview - a.lastReview,
    lapses: (a, b) => b.lapses - a.lapses || a.strength - b.strength,
    due: (a, b) => a.dueIn - b.dueIn,
  };
  const cmp: RowCompare = cmps[by] ?? ((a, b) => a.strength - b.strength);
  return list.sort(cmp);
}

/** How the words met are spread, one count per label. `relearning` is counted
 *  as learning: the difference matters on a card, not in a headline. */
export interface CardTally {
  /** Words met but not yet answered. */
  new: number;
  /** Words still being learned, relearning included. */
  learning: number;
  /** Words in review but not yet known. */
  review: number;
  /** Words whose memory is long enough to call them known. */
  known: number;
}

/** Counts for the header: how the words you have met are spread. */
export function tally(rows: readonly Pick<CardRow, 'label'>[]): CardTally {
  const out: CardTally = { new: 0, learning: 0, review: 0, known: 0 };
  for (const r of rows) {
    const l = r.label === 'relearning' ? 'learning' : r.label;
    out[l] = (out[l] ?? 0) + 1;
  }
  return out;
}

/** 0..1 for a bar: log scale, so a week and a year are both visible. */
export const strengthBar = (days: number): number =>
  Math.min(1, Math.log10(1 + Math.max(0, days)) / Math.log10(366));

/** When a card comes round, said the way a person would: days while they can
 *  be counted, then months, then years. `''` for a card that is not
 *  scheduled at all. */
export function dueText(days: number): string {
  if (!Number.isFinite(days)) return '';
  if (days < -1) return `${Math.round(-days)} d overdue`;
  if (days < 0) return 'due now';
  if (days < 1) return 'due today';
  if (days < 30) return `due in ${Math.round(days)} d`;
  if (days < 365) return `due in ${Math.round(days / 30)} mo`;
  return `due in ${(days / 365).toFixed(1)} y`;
}
