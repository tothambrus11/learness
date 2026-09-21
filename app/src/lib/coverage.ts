/** The headline numbers: how much running French text you can read, and how
 *  much you can use.
 *
 *  Each catalogue word carries its share of text, inflections included, so the
 *  sum over the words you know is the share of an ordinary page you would
 *  understand. It climbs fast early, because the first level is the commonest
 *  words.
 *
 *  "Can read" is the promise the app makes, and it is kept honest two ways. A
 *  word that reads as English counts from its first answered review — you
 *  could read it on sight, and one answer proves you were shown it — but never
 *  from mere introduction, so piling up new cards moves nothing. A word that
 *  does not read as English counts only when its written card is mature.
 *
 *  "Can use" is what the ladder is for: the written card mature at "write it"
 *  or above. It lags "can read", as it should.
 */
import { LOOKS_FREE, RUNGS } from './keys.js';
import type { WordKey } from './keys.js';
import type { IndexEntry, LadderCard, StoredCard, StudyWord } from './model.js';
import { isMature } from './scheduler.js';

/** How one level stands: how many of its words have been started, and how
 *  many have been learned. */
export interface LevelProgress {
  level: number;
  total: number;
  started: number;
  known: number;
}

export interface Coverage {
  /** 0..1 of running text you can read. */
  share: number;
  /** 0..1 of running text you can produce. */
  use: number;
  /** Catalogue words you can read, and produce. */
  known: number;
  usable: number;
  levels: LevelProgress[];
  /** The function words: how many are shipped, and how many are known —
   *  the sense card mature. They carry no share of text (see IndexEntry.kind)
   *  and belong to no level, so they are counted here instead, where the
   *  screen can say "12 of 20" beside a number that never moves for them. */
  functionWords: { total: number; known: number };
}

const WRITE = RUNGS.written.indexOf('write');
const atLeastWrite = (c: LadderCard): boolean => RUNGS.written.indexOf(c.rung) >= WRITE;

export function coverageOf(
  cards: readonly StoredCard[],
  index: readonly IndexEntry[],
): Coverage {
  const written = new Map<WordKey, LadderCard[]>();
  const senseMature = new Set<WordKey>();
  for (const c of cards) {
    if (!c.rung) continue;
    if (c.channel === 'sense') {
      if (isMature(c)) senseMature.add(c.key);
      continue;
    }
    if (c.channel !== 'written') continue;
    const mine = written.get(c.key) ?? [];
    mine.push(c as LadderCard);
    written.set(c.key, mine);
  }
  let share = 0;
  let use = 0;
  let known = 0;
  let usable = 0;
  const functionWords = { total: 0, known: 0 };
  const levels = new Map<number, LevelProgress>();
  for (const w of index) {
    if (w.kind === 'function') {
      functionWords.total += 1;
      if (senseMature.has(w.k)) functionWords.known += 1;
      continue;
    }
    const level = levels.get(w.lvl) ?? { level: w.lvl, total: 0, started: 0, known: 0 };
    level.total += 1;
    const mine = written.get(w.k) ?? [];
    if (mine.length) level.started += 1;
    const answered = mine.some((c) => (c.reps ?? 0) > 0);
    const mature = mine.some(isMature);
    const readable = (w.looks ?? 0) >= LOOKS_FREE ? answered : mature;
    if (readable) {
      level.known += 1;
      known += 1;
      share += w.m ?? 0;
    }
    if (mine.some((c) => atLeastWrite(c) && isMature(c))) {
      usable += 1;
      use += w.m ?? 0;
    }
    levels.set(w.lvl, level);
  }
  return {
    share,                         /* 0..1 of running text you can read */
    use,                           /* 0..1 of running text you can produce */
    known,                         /* catalogue words you can read */
    usable,                        /* catalogue words you can produce */
    levels: [...levels.values()].sort((a, b) => a.level - b.level),
    functionWords,
  };
}

/** A share as a percentage, for a headline number. */
export const percent = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;

/** One word of a level, as the levels list shows it when a level is opened:
 *  the French, its first sense, and where it stands with you. */
export interface LevelWordRow {
  k: WordKey;
  fr: string;
  en: string;
  /** 'not started' | 'up next' | 'learning' | 'due' | 'known' (ladder.ts). */
  status: string;
}

/** The words of a level in the order the level file ranks them — cheapest
 *  first, which is the order the sitting deals them — each with its
 *  standing. The rows are data so the list draws them and decides nothing
 *  (#92). */
export function levelRows(
  words: readonly Pick<StudyWord, 'k' | 'fr' | 'en'>[], statusFor: (key: WordKey) => string,
): LevelWordRow[] {
  return words.map((w) => ({
    k: w.k, fr: w.fr, en: (w.en[0] ?? '').split(';')[0]!.trim(), status: statusFor(w.k),
  }));
}
