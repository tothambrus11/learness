/** Assembling a study session from the catalogue and what you already know.
 *
 *  New words come from the catalogue in ranked order, which is the whole point
 *  of the pipeline: the easiest useful words first. Cards you have already met
 *  come back when they are due, on whichever rung they have reached. A walk is
 *  the same session with the keyboard taken away: only the rungs you can
 *  answer by speaking and tapping.
 */
import { index, level } from './catalogue.js';
import { activeUserWords, anyWord, ensureCards } from './words.js';
import { allCards, cardsFor, db, getCard, getSettings, logReview, putCard, reviewsSince }
  from './db.js';
import { HANDS_FREE } from './keys.js';
import { afterAnswer, entryRung, isActive, rekeyOrphans } from './ladder.js';
import {
  assembleSession, emptyCard, grade, isDue, isMature, newAllowance, pickRefresher,
  retention, scheduler, State,
} from './scheduler.js';

const WEEK = 7 * 86400 * 1000;

/** The cards that can be scheduled: one per word per channel, the highest rung. */
export const sitting = (cards) => cards.filter(isActive);

export async function buildSession({ handsFree = false } = {}) {
  const [settings, loaded, recent, catalogueIndex] = await Promise.all([
    getSettings(), allCards(), reviewsSince(Date.now() - WEEK), index(),
  ]);
  /* A rebuilt catalogue can move a word to another part of speech — "vidéo"
     the adjective becoming "la vidéo". The cards follow, with their state. */
  const stored = await followRenamedWords(loaded, catalogueIndex);
  /* Words that came in by sync or from a Claude conversation get a card now. */
  const everything = [...stored, ...await ensureCards(stored)];
  const cards = sitting(everything);

  const now = new Date();
  const okHere = (c) => !handsFree || HANDS_FREE.has(c.rung);

  /* Your own words go first while they are new; after that they are reviews
     like any other. */
  const first = cards.filter((c) => c.lesson && c.state === State.New && okHere(c));
  const firstIds = new Set(first.map((c) => c.id));
  const due = cards.filter((c) => isDue(c, now) && !firstIds.has(c.id) && okHere(c));

  const retention7d = retention(recent);
  const dueCount = cards.filter((c) => isDue(c, now) && !firstIds.has(c.id)).length;
  const allowance = newAllowance({ dueCount, retention7d, settings });

  /* The index is already in ranked order, so taking from the front is taking
     the easiest useful words that have not been started. A word enters at the
     rung its resemblance to English earns it: "la nation" is read on sight and
     starts by being said; "faire" starts by being recognised. */
  const started = new Set(everything.filter((c) => c.channel === 'written').map((c) => c.key));
  const fresh = [];
  for (const entry of catalogueIndex) {
    if (fresh.length >= allowance) break;
    if (started.has(entry.k)) continue;
    const card = emptyCard(entry.k, 'written', entryRung('written', entry), now);
    if (okHere(card)) fresh.push(card);
  }

  const massOf = new Map(catalogueIndex.map((w) => [w.k, w.lvl]));
  const pool = cards.filter(okHere);
  /* A walk with little due is topped up with words worth keeping warm, so it
     stays useful after the due pile is done. */
  const refresherCount = handsFree
    ? Math.max(0, (settings.sessionLimit ?? 60) - due.length - fresh.length)
    : Math.round((settings.sessionLimit ?? 60) * (settings.refresherShare ?? 0));
  const refresher = pickRefresher(pool, {
    now,
    count: refresherCount,
    /* Commoner words are worth keeping warm more often; level is a proxy for
       frequency, and level 1 is the commonest. */
    weightOf: (key) => 1 / Math.max(1, massOf.get(key) ?? 30),
  });

  const queue = assembleSession({ first, due, newItems: fresh, refresher, settings });
  const items = await withWords(queue, catalogueIndex);
  return { items, settings, allowance, dueCount, retention7d, handsFree };
}

async function followRenamedWords(cards, catalogueIndex) {
  const mine = new Set((await activeUserWords()).map((w) => w.k));
  const moves = rekeyOrphans(cards, catalogueIndex, mine);
  if (!moves.length) return cards;
  const d = await db();
  const tx = d.transaction('cards', 'readwrite');
  for (const [from, to] of moves) {
    tx.store.delete(from.id);
    tx.store.put(to);
  }
  await tx.done;
  const moved = new Map(moves.map(([from, to]) => [from.id, to]));
  return cards.map((c) => moved.get(c.id) ?? c);
}

/** Pull in the level files the queue needs first, so no card waits on a fetch. */
async function withWords(queue, catalogueIndex) {
  const levelOf = new Map(catalogueIndex.map((w) => [w.k, w.lvl]));
  const levels = new Set(queue.map((c) => levelOf.get(c.key)).filter(Boolean));
  await Promise.all([...levels].map((n) => level(n).catch(() => [])));

  const mine = new Map((await activeUserWords()).map((w) => [w.k, w]));
  const items = [];
  for (const card of queue) {
    const w = await anyWord(card.key, mine);
    if (w) items.push({ card, word: w });
  }
  return items;
}

/** Record an answer: update the card, append to the log, climb if the rung is
 *  mature, open the ear the first time the word is said and known, and report
 *  what happened so the screen can say so. */
export async function answer(card, word, rating, settings, ms, { mispronounced = false } = {}) {
  const f = scheduler(settings);
  const before = await getCard(card.id) ?? card;
  const wasMature = isMature(before);
  const now = new Date();
  const updated = grade(f, before, rating, now, settings);
  updated.updatedAt = now.getTime();

  /* The ladder only asks about this word's other rungs, so read those alone
     rather than the whole store on every tap. */
  const step = afterAnswer({ card: updated, rating, word, cards: await cardsFor(card.key), now });
  if (step.retire) updated.retired = true;
  await putCard(updated);
  for (const made of [step.promoted, step.heard]) {
    if (!made) continue;
    made.updatedAt = now.getTime();
    await putCard(made);
  }

  const justLearned = !wasMature && isMature(updated);
  await logReview({
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
  return {
    card: updated, justLearned,
    promoted: step.promoted?.rung ?? null,
    heardOpened: !!step.heard,
  };
}
