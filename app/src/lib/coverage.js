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
import { isMature } from './scheduler.js';

const WRITE = RUNGS.written.indexOf('write');
const atLeastWrite = (c) => RUNGS.written.indexOf(c.rung) >= WRITE;

export function coverageOf(cards, index) {
  const written = new Map();
  for (const c of cards) {
    if (c.channel !== 'written') continue;
    if (!written.has(c.key)) written.set(c.key, []);
    written.get(c.key).push(c);
  }
  let share = 0;
  let use = 0;
  let known = 0;
  let usable = 0;
  const levels = new Map();
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
    share,                         /* 0..1 of running text you can read */
    use,                           /* 0..1 of running text you can produce */
    known,                         /* catalogue words you can read */
    usable,                        /* catalogue words you can produce */
    levels: [...levels.values()].sort((a, b) => a.level - b.level),
  };
}

export const percent = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
