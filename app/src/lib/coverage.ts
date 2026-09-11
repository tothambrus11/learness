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
import { LOOKS_FREE, RUNGS } from './keys';
import { isMature } from './scheduler';
import type { Card, CatalogueEntry, Rung, WordKey } from './types';

/** Where "write it" sits on the written ladder. Everything at or above it
 *  produces the word rather than recognising it. */
const WRITE = (RUNGS.written as readonly Rung[]).indexOf('write');

/** Is this card on a rung that asks the learner to produce the word? */
const atLeastWrite = (c: Pick<Card, 'rung'>): boolean =>
  (RUNGS.written as readonly Rung[]).indexOf(c.rung) >= WRITE;

/** How far one level of a hundred words has been taken. */
export interface LevelProgress {
  /** The level number; 1 is the commonest words. */
  level: number;
  /** How many words the level holds — a hundred, except the last. */
  total: number;
  /** How many have a written card at all, met or not. */
  started: number;
  /** How many count as readable by the rule above. */
  known: number;
}

/** Everything the home screen's headline is made of. */
export interface Coverage {
  /** Share of running French text the learner can read, 0..1. */
  share: number;
  /** Share of running French text the learner can produce, 0..1. */
  use: number;
  /** Catalogue words that count as readable. */
  known: number;
  /** Catalogue words that count as usable. */
  usable: number;
  /** One entry per level, lowest first. */
  levels: LevelProgress[];
}

/** Add up what the cards say about the catalogue.
 *
 *  Only the written channel counts: reading is what the headline promises, and
 *  the heard ladder is a different memory that would double-count the word.
 *  Retired rungs count too — a word that has climbed past "recognise" is not
 *  less known for it.
 */
export function coverageOf(cards: readonly Card[], index: readonly CatalogueEntry[]): Coverage {
  const written = new Map<WordKey, Card[]>();
  for (const c of cards) {
    if (c.channel !== 'written') continue;
    const had = written.get(c.key);
    if (had) had.push(c);
    else written.set(c.key, [c]);
  }
  let share = 0;
  let use = 0;
  let known = 0;
  let usable = 0;
  const levels = new Map<number, LevelProgress>();
  for (const w of index) {
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
    share,
    use,
    known,
    usable,
    levels: [...levels.values()].sort((a, b) => a.level - b.level),
  };
}

/** A 0..1 share as a percentage string, one decimal by default — the headline
 *  moves by tenths, so rounding to whole numbers would make it look stuck. */
export const percent = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;
