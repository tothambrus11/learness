/** Assembling a study session from the catalogue and what you already know. */

import type { FSRS, Grade } from 'ts-fsrs';

import { index, level } from './catalogue';
import { allCards, clearMeta, db, getMeta, getSettings, reviewsSince, setMeta } from './db';
import { afterAnswer, entryRung, isActive, rekeyOrphans, streakAfter } from './ladder';
import { dayStart, metToday } from './progress';
import { parseCardId, resumable, snapshot, topUp } from './queue';
import type { ParsedCardId, SittingState } from './queue';
import {
  assembleSession,
  emptyCard,
  grade,
  isDue,
  isMature,
  newAllowance,
  pickRefresher,
  retention,
  scheduler,
  State,
} from './scheduler';
import type {
  Card,
  CatalogueEntry,
  Review,
  Rung,
  Settings,
  SittingItem,
  SittingSnapshot,
  StudyWord,
  UserWord,
  WordKey,
} from './types';
import { activeUserWords, anyWord, ensureCards } from './words';

/** Seven days in milliseconds: how far back the recall measure looks. */
const WEEK = 7 * 86400 * 1000;

/** The meta key the sitting in progress is written under. */
const SITTING = 'sitting';

/** The cards that can be scheduled: one per word per channel, the highest rung. */
export const sitting = (cards: readonly Card[]): Card[] => cards.filter(isActive);

/** The sitting in progress, if there is one to carry on with. Null where there
 *  is none, where it is from another day, or where it was dealt by a mode this
 *  version no longer has. */
export async function savedSitting(): Promise<SittingSnapshot | null> {
  const saved = await getMeta(SITTING).catch(() => null);
  return resumable(saved, { dayStart: dayStart() }) ? saved : null;
}

/** Write the sitting down, stamped with today. Never rejects: a failed write is
 *  swallowed, since losing the place in a queue must never lose the answer that
 *  was just graded. */
export const rememberSitting = (state: Omit<SittingState, 'day'>): Promise<unknown> =>
  setMeta(SITTING, snapshot({ ...state, day: dayStart() })).catch(() => {});

/** Forget the sitting, once it is finished. */
export const forgetSitting = (): Promise<unknown> => clearMeta(SITTING).catch(() => {});

/** Your own words that belong at the front: not yet met, or met and now owed. */
const ownFirst = (cards: readonly Card[], now: Date): Card[] =>
  cards.filter((c) => c.lesson && (c.state === State.New || isDue(c, now)));

/** The card an id names: the one in the store, or a card made fresh where the
 *  word was dealt but never answered. */
const storedOrFresh = (stored: Card | undefined, { key, channel, rung }: ParsedCardId): Card =>
  stored ?? emptyCard(key, channel, rung);

/** Rebuild the items of a written-down queue. The word is looked up now, so
 *  every edit since the queue was dealt is on it; an id whose word has gone is
 *  dropped, so the result may be shorter than `ids`.
 *
 *  @param mine the learner's own words, so the store is read a single time.
 */
async function itemsForIds(
  ids: readonly string[],
  mine: Map<WordKey, UserWord>,
): Promise<SittingItem[]> {
  const items: SittingItem[] = [];
  const d = await db();
  for (const id of ids) {
    const parsed = parseCardId(id);
    if (!parsed) continue;
    const card = storedOrFresh(await d.get('cards', id), parsed);
    const word = await anyWord(parsed.key, mine);
    if (word) items.push({ card, word });
  }
  return items;
}

/** A sitting, ready to be dealt. */
export interface BuiltSession {
  /** The queue, cards and words together. */
  items: SittingItem[];
  /** The settings it was built under. */
  settings: Settings;
  /** The snapshot it was resumed from, or null for a fresh one. */
  resumed: SittingSnapshot | null;
  /** New words the day still had room for. Only on a fresh sitting. */
  allowance?: number;
  /** Cards that were due when it was built. Only on a fresh sitting. */
  dueCount?: number;
  /** Recall over the last week, or null for too little evidence. */
  retention7d?: number | null;
}

/** True when every id in a saved queue resolved to a word. A word deleted
 *  mid-sitting would otherwise shift the position and the history under it. */
const intact = (items: readonly SittingItem[], saved: SittingSnapshot): boolean =>
  items.length === saved.ids.length;

/** The learner's own words as they stand now, ready to be dealt: the ones added
 *  since a queue was dealt included, so they go in next rather than after the
 *  queue is finished. */
async function ownWordsReady(): Promise<SittingItem[]> {
  const stored = sitting(await allCards());
  const ready = ownFirst(stored, new Date());
  return withWords(ready, await index().catch(() => [] as CatalogueEntry[]));
}

/** The sitting to show now: the one in progress if there is one, else a fresh
 *  one. `resume: false` forces a rebuild. */
export async function buildSession({ resume = true } = {}): Promise<BuiltSession> {
  if (resume) {
    const saved = await savedSitting();
    if (saved) {
      const mine = new Map((await activeUserWords()).map((w) => [w.k, w]));
      const items = await itemsForIds(saved.ids, mine);
      if (intact(items, saved)) {
        const topped = topUp(items, saved.i, await ownWordsReady());
        return { items: [...topped], settings: await getSettings(), resumed: saved };
      }
      await forgetSitting();
    }
  }
  return freshSession();
}

/** How many cards have come round, the learner's own words included — the same
 *  count the home screen shows, and what the day's allowance is measured
 *  against. */
const dueNow = (cards: readonly Card[], now: Date): number =>
  cards.filter((c) => isDue(c, now)).length;

/** The next `allowance` words of the ranking that have not been started, each
 *  on the rung its resemblance to English earns. The index is in ranked order,
 *  so taking from the front is taking the easiest useful words. */
function nextNewCards(
  catalogueIndex: readonly CatalogueEntry[],
  known: readonly Card[],
  allowance: number,
  now: Date,
): Card[] {
  const started = new Set(known.filter((c) => c.channel === 'written').map((c) => c.key));
  const fresh: Card[] = [];
  for (const entry of catalogueIndex) {
    if (fresh.length >= allowance) break;
    if (started.has(entry.k)) continue;
    fresh.push(emptyCard(entry.k, 'written', entryRung('written', entry), now));
  }
  return fresh;
}

/** How much a word is worth keeping warm, by key: the commoner the word, the
 *  more often. Level is the proxy for frequency, and level 1 is the commonest. */
function warmthWeight(catalogueIndex: readonly CatalogueEntry[]): (key: WordKey) => number {
  const levelOf = new Map(catalogueIndex.map((w) => [w.k, w.lvl]));
  return (key) => 1 / Math.max(1, levelOf.get(key) ?? 30);
}

/** Deal a new queue from what is due, what is owed and what is next in the
 *  ranking, and write it down. */
async function freshSession(): Promise<BuiltSession> {
  const [settings, loaded, recent, catalogueIndex] = await Promise.all([
    getSettings(),
    allCards(),
    reviewsSince(Date.now() - WEEK),
    index(),
  ]);
  const stored = await followRenamedWords(loaded, catalogueIndex);
  const everything = [...stored, ...(await ensureCards(stored))];
  const cards = sitting(everything);

  const now = new Date();
  const first = ownFirst(cards, now);
  const firstIds = new Set(first.map((c) => c.id));
  const due = cards.filter((c) => isDue(c, now) && !firstIds.has(c.id));

  const retention7d = retention(recent);
  const dueCount = dueNow(cards, now);
  const allowance = newAllowance({
    dueCount,
    retention7d,
    settings,
    introducedToday: metToday(recent, now),
  });

  const fresh = nextNewCards(catalogueIndex, everything, allowance, now);
  const refresher = pickRefresher(cards, {
    now,
    count: Math.round((settings.sessionLimit ?? 60) * (settings.refresherShare ?? 0)),
    weightOf: warmthWeight(catalogueIndex),
  });

  const queue = assembleSession({ first, due, newItems: fresh, refresher, settings });
  const items = await withWords(queue, catalogueIndex);
  await rememberSitting({ items, i: 0, done: {}, history: [] });
  return { items, settings, allowance, dueCount, retention7d, resumed: null };
}

/** Move cards whose key the catalogue has re-filed, and persist the moves.
 *  Returns the cards with the moved ones replaced, so the caller never works
 *  from the stale keys. */
async function followRenamedWords(
  cards: readonly Card[],
  catalogueIndex: readonly CatalogueEntry[],
): Promise<Card[]> {
  const mine = new Set((await activeUserWords()).map((w) => w.k));
  const moves = rekeyOrphans(cards, catalogueIndex, mine);
  if (!moves.length) return [...cards];
  const d = await db();
  const tx = d.transaction('cards', 'readwrite');
  for (const [from, to] of moves) {
    void tx.store.delete(from.id);
    void tx.store.put(to);
  }
  await tx.done;
  const moved = new Map(moves.map(([from, to]) => [from.id, to]));
  return cards.map((c) => moved.get(c.id) ?? c);
}

/** Pull in the level files the queue needs first, so no card waits on a fetch,
 *  then resolve every card to the word it is about. Cards whose word cannot be
 *  resolved are dropped. */
async function withWords(
  queue: readonly Card[],
  catalogueIndex: readonly CatalogueEntry[],
): Promise<SittingItem[]> {
  const levelOf = new Map(catalogueIndex.map((w) => [w.k, w.lvl]));
  const levels = new Set(
    queue.map((c) => levelOf.get(c.key)).filter((n): n is number => n !== undefined),
  );
  await Promise.all([...levels].map((n) => level(n).catch(() => [])));

  const mine = new Map((await activeUserWords()).map((w) => [w.k, w]));
  const items: SittingItem[] = [];
  for (const card of queue) {
    const w = await anyWord(card.key, mine);
    if (w) items.push({ card, word: w });
  }
  return items;
}

/** What one answer did, for the screen to report. */
export interface AnswerResult {
  /** The card as it now stands. */
  card: Card;
  /** True when this answer was the one that made the word count as known. */
  justLearned: boolean;
  /** The rung this answer climbed to, or null. */
  promoted: Rung | null;
  /** True when this answer opened the heard ladder for the word. */
  heardOpened: boolean;
}

/** The card as this answer leaves it: graded, stamped with `now`, and with the
 *  streak carried on from the card as it was stored. The card handed in is not
 *  touched. */
function answered(f: FSRS, before: Card, rating: Grade, now: Date, settings: Settings): Card {
  const updated = grade(f, before, rating, now, settings);
  updated.updatedAt = now.getTime();
  updated.streak = streakAfter(before, rating);
  return updated;
}

/** What the log records about one answer beyond the card it was given on. */
interface AnswerFacts {
  /** What was pressed. */
  rating: Grade;
  /** Milliseconds spent, or null where it was not measured. */
  ms: number | null;
  /** True when this answer was the one that made the word count as known. */
  justLearned: boolean;
  /** The rung this answer climbed to, or null. */
  promoted: Rung | null;
  /** Said aloud and it came out wrong. A flag beside the grade, never part of
   *  it: it must not shorten the interval of the memory the card tests. */
  mispronounced: boolean;
  /** The moment of the answer. */
  now: Date;
}

/** One row of the log. `before` is the card as it stood a moment ago, which is
 *  the only thing that can say which state the answer was given from. */
function reviewOf(card: Card, before: Pick<Card, 'state'>, facts: AnswerFacts): Review {
  return {
    uid: crypto.randomUUID(),
    id: card.id,
    key: card.key,
    channel: card.channel,
    rung: card.rung,
    direction: `${card.channel}/${card.rung}`,
    ts: Math.floor(facts.now.getTime() / 1000),
    rating: facts.rating,
    ms: facts.ms ?? null,
    state: before.state,
    learned: facts.justLearned,
    promoted: facts.promoted,
    mispronounced: facts.mispronounced,
  };
}

/** Record an answer: update the card, append to the log, climb if the rung is
 *  mature, open the ear the first time the word is said and known, and report
 *  what happened so the screen can say so.
 *
 *  One transaction: the card, anything the climb creates and the log row are
 *  written together or not at all, and the card is re-read inside it. Throws
 *  and writes nothing if the write fails.
 */
export async function answer(
  card: Card,
  word: StudyWord,
  rating: Grade,
  settings: Settings,
  ms: number | null,
  { mispronounced = false }: { mispronounced?: boolean } = {},
): Promise<AnswerResult> {
  const f = scheduler(settings);
  const now = new Date();
  const d = await db();
  const tx = d.transaction(['cards', 'reviews'], 'readwrite');
  const cards = tx.objectStore('cards');

  const before = (await cards.get(card.id)) ?? card;
  const wasMature = isMature(before);
  const updated = answered(f, before, rating, now, settings);

  const siblings = await cards.index('key').getAll(card.key);
  const step = afterAnswer({ card: updated, rating, word, cards: siblings, now });
  if (step.retire) updated.retired = true;
  void cards.put(updated);
  for (const made of [step.promoted, step.heard]) {
    if (!made) continue;
    made.updatedAt = now.getTime();
    void cards.put(made);
  }

  const justLearned = !wasMature && isMature(updated);
  void tx.objectStore('reviews').add(
    reviewOf(updated, before, {
      rating,
      ms,
      justLearned,
      promoted: step.promoted?.rung ?? null,
      mispronounced,
      now,
    }),
  );
  await tx.done;
  return {
    card: updated,
    justLearned,
    promoted: step.promoted?.rung ?? null,
    heardOpened: !!step.heard,
  };
}
