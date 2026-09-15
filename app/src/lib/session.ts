/** Assembling a study session from the catalogue and what you already know.
 *
 *  New words come from the catalogue in ranked order, which is the whole point
 *  of the pipeline: the easiest useful words first. Cards you have already met
 *  come back when they are due, on whichever rung they have reached.
 *
 *  There is one kind of sitting. There were two — the desk and a "walk" that
 *  served only the three rungs answerable by speaking and tapping — but a walk
 *  was a subset of this one with bigger buttons, so it was two queues, two
 *  resume rules and two sets of copy for no exercise the desk did not already
 *  have.
 */
import { index, level } from './catalogue.js';
import { activeUserWords, anyWord, ensureCards } from './words.js';
import { allCards, cardsFor, clearMeta, db, getCard, getMeta, getSettings, logReview, putCard,
  reviewsSince, setMeta } from './db.js';
import type { CardId, Rung, WordKey } from './keys.js';
import { afterAnswer, entryRung, isActive, rekeyOrphans, streakAfter } from './ladder.js';
import type {
  IndexEntry, LadderCard, Settings, StoredCard, StudyWord, UserWord,
} from './model.js';
import { dayStart, keysAnsweredBefore, metOn } from './progress.js';
import { parseCardId, resumable, snapshot } from './queue.js';
import type { HistoryEntry, SavedSitting, StudyItem, Tally } from './queue.js';
import {
  assembleSession, emptyCard, grade, isDue, isMature, newAllowance, pickRefresher,
  retention, scheduler, State,
} from './scheduler.js';
import type { Grade } from './scheduler.js';
import { agoMs, atMs, secOf, WEEK_MS } from './units.js';

const SITTING = 'sitting';

/** A sitting, ready for the screen to deal. */
export interface Session {
  items: StudyItem[];
  settings: Settings;
  /** The queue this carries on with, or null for a fresh one. */
  resumed: SavedSitting | null;
  /** The arithmetic behind a fresh queue, for a screen that wants to say it. */
  allowance?: number;
  dueCount?: number;
  retention7d?: number | null;
  introducedToday?: number;
}

/** What one answer did, beyond changing the card. */
export interface AnswerResult {
  card: LadderCard;
  justLearned: boolean;
  /** The rung the word climbed to, or null. */
  promoted: Rung | null;
  /** The heard channel opened, because the word was produced aloud. */
  heardOpened: boolean;
}

/** The cards that can be scheduled: one per word per channel, the highest rung. */
export const sitting = (cards: readonly StoredCard[]): LadderCard[] => cards.filter(isActive);

/** The sitting in progress, if there is one to carry on with. */
export async function savedSitting(): Promise<SavedSitting | null> {
  const saved = await getMeta<SavedSitting>(SITTING).catch(() => null);
  return saved && resumable(saved, { dayStart: dayStart() }) ? saved : null;
}

export const rememberSitting = (state: {
  items: readonly StudyItem[];
  i: number;
  done: Partial<Tally>;
  history: readonly HistoryEntry[];
}): Promise<void> =>
  setMeta(SITTING, snapshot({ ...state, day: dayStart() })).then(() => {}, () => {});
export const forgetSitting = (): Promise<void> =>
  clearMeta(SITTING).catch(() => {});

/** Rebuild the items of a written-down queue.
 *
 *  The card comes from the database where it has one and is made fresh where it
 *  does not — a new word that was dealt but never answered — and the word is
 *  looked up now, so every edit since is on the card.
 */
async function itemsForIds(
  ids: readonly CardId[], mine: ReadonlyMap<WordKey, UserWord>,
): Promise<StudyItem[]> {
  const items: StudyItem[] = [];
  for (const id of ids) {
    const parsed = parseCardId(id);
    if (!parsed) continue;
    const stored = await getCard(id);
    /* The id names the channel and the rung, so a row found under it is on
       that rung whatever the row itself carries; a card that was dealt and
       never answered has no row at all and is made fresh. */
    const card: LadderCard = stored
      ? { ...stored, channel: parsed.channel, rung: parsed.rung }
      : emptyCard(parsed.key, parsed.channel, parsed.rung);
    const word = await anyWord(parsed.key, mine);
    if (word) items.push({ card, word });
  }
  return items;
}

export async function buildSession(
  { resume = true }: { resume?: boolean } = {},
): Promise<Session> {
  if (resume) {
    const saved = await savedSitting();
    if (saved) {
      const mine = new Map((await activeUserWords()).map((w) => [w.k, w]));
      const items = await itemsForIds(saved.ids, mine);
      /* Only if every card still resolves; a word deleted mid-sitting would
         otherwise shift the position and the history under it. */
      if (items.length === saved.ids.length) {
        return { items, settings: await getSettings(), resumed: saved };
      }
      await forgetSitting();
    }
  }
  return freshSession();
}

async function freshSession(): Promise<Session> {
  const [settings, loaded, recent, catalogueIndex] = await Promise.all([
    getSettings(), allCards(), reviewsSince(agoMs(WEEK_MS)), index(),
  ]);
  /* A rebuilt catalogue can move a word to another part of speech — "vidéo"
     the adjective becoming "la vidéo". The cards follow, with their state. */
  const stored = await followRenamedWords(loaded, catalogueIndex);
  /* Words that came in by sync or from a Claude conversation get a card now. */
  const everything = [...stored, ...await ensureCards(stored)];
  const cards = sitting(everything);

  const now = new Date();

  /* Your own words go first while they are new; after that they are reviews
     like any other. */
  const first = cards.filter((c) => c.lesson && c.state === State.New);
  const firstIds = new Set(first.map((c) => c.id));
  const due = cards.filter((c) => isDue(c, now) && !firstIds.has(c.id));

  const retention7d = retention(recent);
  const dueCount = cards.filter((c) => isDue(c, now) && !firstIds.has(c.id)).length;
  /* What today has already spent. Without it every new sitting dealt a fresh
     maxNewPerDay, so a day of short sittings met the whole front of the
     catalogue — the easiest words there are — and never came back to any of
     them. The ceiling is for the day, not for the sitting. */
  const introducedToday = metOn(recent, {
    at: now,
    /* From the cards, not from the week of log that is loaded here: a rung
       opened today on a word known for months is a review row that says
       State.New, and only the word's other cards can say it is not a word met
       today. Rows written since the session started recording `met` answer for
       themselves; this is what keeps the older ones honest. */
    seenBefore: keysAnsweredBefore(everything, dayStart(now)),
  }).length;
  const allowance = newAllowance({ dueCount, retention7d, settings, introducedToday });

  /* The index is already in ranked order, so taking from the front is taking
     the easiest useful words that have not been started. A word enters at the
     rung its resemblance to English earns it: "la nation" is read on sight and
     starts by being said; "faire" starts by being recognised. */
  const started = new Set(everything.filter((c) => c.channel === 'written').map((c) => c.key));
  const fresh: LadderCard[] = [];
  for (const entry of catalogueIndex) {
    if (fresh.length >= allowance) break;
    if (started.has(entry.k)) continue;
    fresh.push(emptyCard(entry.k, 'written', entryRung('written', entry), now));
  }

  const massOf = new Map(catalogueIndex.map((w) => [w.k, w.lvl]));
  /* A share of every sitting is words already known, kept warm before they
     are due. */
  const refresherCount =
    Math.round((settings.sessionLimit ?? 60) * (settings.refresherShare ?? 0));
  const refresher = pickRefresher(cards, {
    now,
    count: refresherCount,
    /* Commoner words are worth keeping warm more often; level is a proxy for
       frequency, and level 1 is the commonest. */
    weightOf: (key: WordKey): number => 1 / Math.max(1, massOf.get(key) ?? 30),
  });

  const queue = assembleSession({ first, due, newItems: fresh, refresher, settings });
  const items = await withWords(queue, catalogueIndex);
  await rememberSitting({ items, i: 0, done: {}, history: [] });
  return { items, settings, allowance, dueCount, retention7d, introducedToday,
    resumed: null };
}

async function followRenamedWords(
  cards: readonly StoredCard[], catalogueIndex: readonly IndexEntry[],
): Promise<StoredCard[]> {
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

/** Pull in the level files the queue needs first, so no card waits on a fetch. */
async function withWords(
  queue: readonly LadderCard[], catalogueIndex: readonly IndexEntry[],
): Promise<StudyItem[]> {
  const levelOf = new Map(catalogueIndex.map((w) => [w.k, w.lvl]));
  const levels = new Set(queue.map((c) => levelOf.get(c.key)).filter((n): n is number => !!n));
  await Promise.all([...levels].map((n) => level(n).catch(() => [])));

  const mine = new Map((await activeUserWords()).map((w) => [w.k, w]));
  const items: StudyItem[] = [];
  for (const card of queue) {
    const w = await anyWord(card.key, mine);
    if (w) items.push({ card, word: w });
  }
  return items;
}

/** Record an answer: update the card, append to the log, climb if the rung is
 *  mature, open the ear the first time the word is said and known, and report
 *  what happened so the screen can say so. */
export async function answer(
  card: LadderCard,
  word: StudyWord,
  rating: Grade,
  settings: Settings,
  ms: number | null,
  { mispronounced = false }: { mispronounced?: boolean } = {},
): Promise<AnswerResult> {
  const f = scheduler(settings);
  /* The stored card where there is one: the queue's copy was read when the
     sitting was dealt and may be several answers old. A row found under this
     id is on this rung — the id is made of them — so the channel and rung are
     carried over rather than re-read. */
  const stored = await getCard(card.id);
  const before: LadderCard = stored
    ? { ...stored, channel: card.channel, rung: card.rung }
    : card;
  const wasMature = isMature(before);
  const now = new Date();
  const updated = grade(f, before, rating, now, settings);
  updated.updatedAt = atMs(now);
  updated.streak = streakAfter(before, rating);

  /* The ladder only asks about this word's other rungs, so read those alone
     rather than the whole store on every tap. */
  const rungs = await cardsFor(card.key);
  /* Nothing on any rung of this word has been answered yet, so this answer is
     the word itself being met. Taken before the card is written back, since
     afterwards it is no longer true of anything. */
  const firstMeeting = rungs.every((c) => (c.reps ?? 0) === 0);
  const step = afterAnswer({ card: updated, rating, word, cards: rungs, now });
  if (step.retire) updated.retired = true;
  await putCard(updated);
  for (const made of [step.promoted, step.heard]) {
    if (!made) continue;
    made.updatedAt = atMs(now);
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
    ts: secOf(atMs(now)),
    rating,
    ms: ms ?? null,
    state: before.state,
    /* Written down here because it cannot be recovered later: whether this
       answer was the one that made the word stick depends on the card as it
       was a moment ago, which the card no longer remembers. */
    learned: justLearned,
    /* Likewise beyond recovery later: whether the word was new to you is a
       fact about the cards as they were a moment ago. The day's new-word
       allowance is spent against this. */
    met: firstMeeting,
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
