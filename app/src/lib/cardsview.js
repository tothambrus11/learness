/** Every word you have met, ranked by how well you know it.
 *
 *  "How well" is the written card's stability: FSRS's estimate, in days, of
 *  how long the memory lasts before recall drops to 90%. It is the one number
 *  that moves with every answer and means the same thing for every word. The
 *  heard channel is shown beside it, since a word you read easily may still be
 *  one you cannot catch.
 */
import { CHANNELS, RUNGS } from './keys.js';
import { isActive } from './ladder.js';
import { isMature, State } from './scheduler.js';

const DAY = 86400000;

export const SORTS = {
  weakest: 'weakest first',
  strongest: 'strongest first',
  recent: 'last seen',
  lapses: 'most forgotten',
  due: 'due soonest',
};

/** One word per rung, for the chips. */
export const SHORT = {
  recognise: 'read', say: 'say', write: 'write', use: 'use', hear: 'hear', dictate: 'dictate',
};

function describe(card, log, now) {
  const total = log.length;
  const right = log.filter((r) => r.rating >= 3).length;
  const dueIn = (new Date(card.due) - now) / DAY;
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
    lastReview: card.last_review ? new Date(card.last_review).getTime() : 0,
    accuracy: total ? right / total : null,
    answers: total,
  };
}

export function stateLabel(d) {
  if (d.state === State.New || d.reps === 0) return 'new';
  if (d.mature) return 'known';
  if (d.state === State.Relearning) return 'relearning';
  if (d.state === State.Learning) return 'learning';
  return 'review';
}

/** One row per word, with each channel's active rung and the word's headline.
 *  Retired rungs are folded in only as history: their lapses count against
 *  the word, the rest is the card that is live. */
export function summarise({ cards, reviews, wordOf, now = new Date() }) {
  const byCard = new Map();
  for (const r of reviews) {
    if (!byCard.has(r.id)) byCard.set(r.id, []);
    byCard.get(r.id).push(r);
  }
  const rows = new Map();
  const retiredLapses = new Map();
  for (const c of cards) {
    if (!c.channel) continue;
    if (!rows.has(c.key)) {
      const w = wordOf(c.key);
      rows.set(c.key, { key: c.key, fr: w?.fr ?? c.key.split('|')[0], en: w?.en?.[0] ?? '',
        gender: w?.gender ?? '', lvl: w?.lvl ?? 0, user: !!w?.user, channels: {} });
    }
    if (isActive(c)) {
      rows.get(c.key).channels[c.channel] = describe(c, byCard.get(c.id) ?? [], now);
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

export function sortRows(rows, by) {
  const list = [...rows];
  const cmp = {
    weakest: (a, b) => a.strength - b.strength || b.lapses - a.lapses || a.fr.localeCompare(b.fr),
    strongest: (a, b) => b.strength - a.strength || a.fr.localeCompare(b.fr),
    recent: (a, b) => b.lastReview - a.lastReview,
    lapses: (a, b) => b.lapses - a.lapses || a.strength - b.strength,
    due: (a, b) => a.dueIn - b.dueIn,
  }[by] ?? ((a, b) => a.strength - b.strength);
  return list.sort(cmp);
}

/** Counts for the header: how the words you have met are spread. */
export function tally(rows) {
  const out = { new: 0, learning: 0, review: 0, known: 0 };
  for (const r of rows) {
    const l = r.label === 'relearning' ? 'learning' : r.label;
    out[l] = (out[l] ?? 0) + 1;
  }
  return out;
}

/** 0..1 for a bar: log scale, so a week and a year are both visible. */
export const strengthBar = (days) => Math.min(1, Math.log10(1 + Math.max(0, days)) / Math.log10(366));

export function dueText(days) {
  if (!Number.isFinite(days)) return '';
  if (days < -1) return `${Math.round(-days)} d overdue`;
  if (days < 0) return 'due now';
  if (days < 1) return 'due today';
  if (days < 30) return `due in ${Math.round(days)} d`;
  if (days < 365) return `due in ${Math.round(days / 30)} mo`;
  return `due in ${(days / 365).toFixed(1)} y`;
}
