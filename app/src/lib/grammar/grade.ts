/** How an exercise's parts become grades: a rule is not a word
 *  (GRAMMAR.md, "Grading: a rule is not a word").
 *
 *  A table with six cells is one act of recall of the ending rule and one
 *  observation each on whatever irregular cells it has, so the grade is
 *  routed, not averaged: every rule the parts observed gets one grade from
 *  its own observations, and every item — an irregular form of one verb —
 *  gets its own from its own cell, on the verb's existing form card. Which
 *  card of a rule takes the grade is the face's mode: reading it back is one
 *  memory, producing it another, as a word's written and heard channels are.
 *
 *  Pure, so a table of parts in a test says what every shape of answer is
 *  worth; session.ts applies what this decides.
 */
import { CLIMB_STREAK } from '../ladder.js';
import type { RuleMode } from '../model.js';
import type { AttemptPart } from '../model.js';
import type { WordKey } from '../keys.js';
import { ruleCardId, trustWordKey } from '../keys.js';
import { Rating } from '../scheduler.js';
import type { Grade } from '../scheduler.js';
import { isRuleId } from './rules.js';
import type { Face } from './rules.js';

/** Which memory each face exercises. Reading, choosing, telling which and
 *  hearing observe recognition; everything the learner writes or says is
 *  production. */
export const FACE_MODE: Readonly<Record<Face, RuleMode>> = {
  read: 'recognise', choose: 'recognise', which: 'recognise', hear: 'recognise',
  gap: 'produce', say: 'produce', transform: 'produce', order: 'produce',
  mark: 'produce', spell: 'produce',
};

/** Over one card's observations in one exercise: all right is Good, one
 *  wrong is Hard, more is Again. Nothing observed is nothing to grade. */
export function tally(oks: readonly boolean[]): Grade | null {
  if (oks.length === 0) return null;
  const wrong = oks.filter((ok) => !ok).length;
  if (wrong === 0) return Rating.Good;
  return wrong === 1 ? Rating.Hard : Rating.Again;
}

/** A rule's grade: the tally, and Easy instead of Good on a streak, as the
 *  ladder climbs today — a rule got right on every part several exercises
 *  running is one FSRS should push further out than a plain Good does. */
export function ruleGrade(oks: readonly boolean[], streak: number): Grade | null {
  const g = tally(oks);
  return g === Rating.Good && streak >= CLIMB_STREAK ? Rating.Easy : g;
}

/** The label a part carries when it is evidence about one verb's own form
 *  rather than about a rule: `item:<word key>:<tense>:<person>`. The
 *  generators write it with `itemRef` and the router reads it with
 *  `parseItemRef`, so the two cannot drift. */
export const itemRef = (key: WordKey, tense: string, person: string): string =>
  `item:${key}:${tense}:${person}`;

export interface ItemRef { key: WordKey; tense: string; person: string }

/** The item a label names, or null for a rule id or anything else. A word
 *  key has no colon in it, so the last two fields are the tense and the
 *  person whatever the key is. */
export function parseItemRef(label: string): ItemRef | null {
  if (!label.startsWith('item:')) return null;
  const fields = label.slice('item:'.length).split(':');
  if (fields.length < 3) return null;
  const person = fields.pop()!;
  const tense = fields.pop()!;
  const key = fields.join(':');
  if (!key || !tense || !person) return null;
  return { key: trustWordKey(key), tense, person };
}

/** What one exercise grades, decided from its parts. */
export interface Routing {
  /** One grade per rule observed, on the card of the face's mode. */
  rules: { id: string; rule: string; rating: Grade }[];
  /** One grade per verb whose own forms the parts observed, for its form
   *  card, with the cells that were wrong so the next deal can prefer them. */
  items: { key: WordKey; rating: Grade; missed: ItemRef[] }[];
}

/** Route the parts' observations to the cards they are evidence about.
 *
 *  A rule's grade reads its card's streak, given here by card id so the
 *  router stays pure; a rule with no card yet has no streak. An item's grade
 *  is the tally alone, never Easy: the form card climbs its own ladder on
 *  its own answers, and a table is not the place to hurry that. A label
 *  that is neither an item nor a rule this version knows is ignored, as an
 *  attempt from a generator this version does not know is. */
export function routeGrades(
  parts: readonly AttemptPart[], mode: RuleMode,
  streakOf: (cardId: string) => number = () => 0,
): Routing {
  const byRule = new Map<string, boolean[]>();
  const byWord = new Map<WordKey, { oks: boolean[]; missed: ItemRef[] }>();
  for (const part of parts) {
    for (const ob of part.obs) {
      const item = parseItemRef(ob.of);
      if (item) {
        const w = byWord.get(item.key) ?? { oks: [], missed: [] };
        w.oks.push(ob.ok);
        if (!ob.ok) w.missed.push(item);
        byWord.set(item.key, w);
      } else if (isRuleId(ob.of)) {
        const r = byRule.get(ob.of) ?? [];
        r.push(ob.ok);
        byRule.set(ob.of, r);
      }
    }
  }
  const rules: Routing['rules'] = [];
  for (const [rule, oks] of byRule) {
    const id = ruleCardId(rule, mode);
    const rating = ruleGrade(oks, streakOf(id));
    if (rating !== null) rules.push({ id, rule, rating });
  }
  const items: Routing['items'] = [];
  for (const [key, { oks, missed }] of byWord) {
    const rating = tally(oks);
    if (rating !== null) items.push({ key, rating, missed });
  }
  return { rules, items };
}
