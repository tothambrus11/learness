/** Assembling a study session from the catalogue and what you already know.
 *
 *  New words come from the catalogue in ranked order, which is the whole point
 *  of the pipeline: the easiest useful words first. Cards you have already met
 *  come back when they are due, on whichever rung they have reached. Words you
 *  added yourself come before either, because you asked for them.
 */
import type { Grade } from 'ts-fsrs';

import { index, level } from './catalogue';
import { allCards, clearMeta, db, getMeta, getSettings, reviewsSince, setMeta } from './db';
import { afterAnswer, entryRung, isActive, rekeyOrphans, streakAfter } from './ladder';
import { dayStart, metToday } from './progress';
import { parseCardId, resumable, snapshot, topUp } from './queue';
import type { SittingState } from './queue';
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

/** Write the sitting down, stamped with today. Failures are swallowed: losing
 *  the place in a queue must never lose the answer that was just graded. */
export const rememberSitting = (state: Omit<SittingState, 'day'>): Promise<unknown> =>
  setMeta(SITTING, snapshot({ ...state, day: dayStart() })).catch(() => {});

/** Forget the sitting, once it is finished. */
export const forgetSitting = (): Promise<unknown> => clearMeta(SITTING).catch(() => {});

/** Your own words that belong at the front: not yet met, or met and now owed.
 *  They were added on purpose, so they never wait behind the catalogue. */
const ownFirst = (cards: readonly Card[], now: Date): Card[] =>
  cards.filter((c) => c.lesson && (c.state === State.New || isDue(c, now)));

/** Rebuild the items of a written-down queue.
 *
 *  The card comes from the database where it has one and is made fresh where it
 *  does not — a new word that was dealt but never answered — and the word is
 *  looked up now, so every edit since is on the card. A card whose word has
 *  gone is dropped, which the caller notices by the count coming up short.
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
    const card =
      (await d.get('cards', id)) ?? emptyCard(parsed.key, parsed.channel, parsed.rung);
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

/** The sitting to show now: the one in progress if there is one, else a fresh
 *  one. Resuming is the default because a queue half-done is the learner's to
 *  finish; `resume: false` forces a rebuild. */
export async function buildSession({ resume = true } = {}): Promise<BuiltSession> {
  if (resume) {
    const saved = await savedSitting();
    if (saved) {
      const mine = new Map((await activeUserWords()).map((w) => [w.k, w]));
      const items = await itemsForIds(saved.ids, mine);
      /* Only if every card still resolves; a word deleted mid-sitting would
         otherwise shift the position and the history under it. */
      if (items.length === saved.ids.length) {
        /* Words added since the queue was dealt go in next, not after the
           queue is finished: the words page says "up next", and it used to be
           true only when nothing was half-done. Answered cards stay where they
           are, so the history under them still lines up. */
        const stored = sitting(await allCards());
        const added = await withWords(
          ownFirst(stored, new Date()),
          await index().catch(() => [] as CatalogueEntry[]),
        );
        const topped = topUp(items, saved.i, added);
        return { items: [...topped], settings: await getSettings(), resumed: saved };
      }
      await forgetSitting();
    }
  }
  return freshSession();
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
  /* A rebuilt catalogue can move a word to another part of speech — "vidéo"
     the adjective becoming "la vidéo". The cards follow, with their state. */
  const stored = await followRenamedWords(loaded, catalogueIndex);
  /* Words that came in by sync or from a Claude conversation get a card now. */
  const everything = [...stored, ...(await ensureCards(stored))];
  const cards = sitting(everything);

  const now = new Date();
  const first = ownFirst(cards, now);
  const firstIds = new Set(first.map((c) => c.id));
  const due = cards.filter((c) => isDue(c, now) && !firstIds.has(c.id));

  const retention7d = retention(recent);
  /* The same count the home screen shows: everything due, your own included. */
  const dueCount = cards.filter((c) => isDue(c, now)).length;
  const allowance = newAllowance({
    dueCount,
    retention7d,
    settings,
    introducedToday: metToday(recent, now),
  });

  /* The index is already in ranked order, so taking from the front is taking
     the easiest useful words that have not been started. A word enters at the
     rung its resemblance to English earns: "la nation" is read on sight and
     starts by being written; "faire" starts by being recognised. */
  const started = new Set(everything.filter((c) => c.channel === 'written').map((c) => c.key));
  const fresh: Card[] = [];
  for (const entry of catalogueIndex) {
    if (fresh.length >= allowance) break;
    if (started.has(entry.k)) continue;
    fresh.push(emptyCard(entry.k, 'written', entryRung('written', entry), now));
  }

  const massOf = new Map(catalogueIndex.map((w) => [w.k, w.lvl]));
  const refresher = pickRefresher(cards, {
    now,
    count: Math.round((settings.sessionLimit ?? 60) * (settings.refresherShare ?? 0)),
    /* Commoner words are worth keeping warm more often; level is a proxy for
       frequency, and level 1 is the commonest. */
    weightOf: (key) => 1 / Math.max(1, massOf.get(key) ?? 30),
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

/** Record an answer: update the card, append to the log, climb if the rung is
 *  mature, open the ear the first time the word is said and known, and report
 *  what happened so the screen can say so.
 *
 *  One transaction. The card, whatever the climb creates, and the log row are
 *  written together or not at all; a tab reclaimed halfway through used to be
 *  able to leave a graded card with no record of the answer, or the other way
 *  round. The card is read inside the same transaction, so the answer is
 *  applied to the card as it is now, not as the queue remembered it.
 *
 *  Throws if the write fails, and writes nothing in that case: the caller
 *  keeps the card on screen and the learner can answer it again.
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
  const updated = grade(f, before, rating, now, settings);
  updated.updatedAt = now.getTime();
  updated.streak = streakAfter(before, rating);

  /* The ladder only asks about this word's other rungs, so read those alone
     rather than the whole store on every tap. */
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
  void tx.objectStore('reviews').add({
    uid: crypto.randomUUID(),
    id: updated.id,
    key: updated.key,
    channel: updated.channel,
    rung: updated.rung,
    direction: `${updated.channel}/${updated.rung}`,
    ts: Math.floor(now.getTime() / 1000),
    rating,
    ms: ms ?? null,
    state: before.state,
    /* Written down here because it cannot be recovered later: whether this
       answer was the one that made the word stick depends on the card as it
       was a moment ago, which the card no longer remembers. */
    learned: justLearned,
    promoted: step.promoted?.rung ?? null,
    /* Separate from the rating on purpose. The rating says whether the memory
       the card tests held up; this says whether the word came out of your
       mouth right, which is a different memory and must not shorten the
       interval of the first one. It is a flag, so it can be skipped. */
    mispronounced,
  });
  await tx.done;
  return {
    card: updated,
    justLearned,
    promoted: step.promoted?.rung ?? null,
    heardOpened: !!step.heard,
  };
}
