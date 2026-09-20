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
 *
 *  And the sitting is derived, not stored. Every open asks for it again, from
 *  the cards, the day's log, the settings and the clock, and gets the same
 *  answer unless something has changed — a word added, a card fallen due, a
 *  card answered on the other phone — in which case it gets the answer that
 *  reflects the change. What is written down is the day: its tally and its
 *  answers, by id (queue.ts).
 */
import { index, level } from './catalogue.js';
import { dealRules } from './grammar/deal.js';
import { committed, dueRules } from './grammar/derive.js';
import { openedTenses } from './grammar/gate.js';
import { candidateVerbs } from './grammar/screen.js';
import { TABLE_RULE_IDS, tablesFor } from './grammar/table.js';
import { FACE_MODE, routeGrades } from './grammar/grade.js';
import type { Face } from './grammar/rules.js';
import { activeUserWords, anyWord, ensureCards } from './words.js';
import { allAttempts, allCards, allRuleCards, cardsFor, clearMeta, db, getCard, getMeta,
  getRuleCard, getSettings, logAttempt, logReview, openBits, putCard, putRuleCard, reviewsSince,
  setMeta } from './db.js';
import { cardId, ruleCardId, trustWordKey } from './keys.js';
import type { Rung, WordKey } from './keys.js';
import {
  afterAnswer, askable, entryChannel, entryRung, isActive, regateForms, rekeyOrphans, streakAfter,
} from './ladder.js';
import { ATTEMPT_V } from './model.js';
import type {
  Attempt, AttemptPart, BitState, IndexEntry, LadderCard, RuleCard, Settings, StoredCard,
  StudyWord, UserWord,
} from './model.js';
import { dayStart, keysAnsweredBefore, metOn } from './progress.js';
import { dayRecord, EMPTY_TALLY, parseCardId, restoreHistory, sameDay } from './queue.js';
import type { DayRecord, HistoryEntry, RuleItem, StudyItem, Tally } from './queue.js';
import { dayPlan, interleave, isLearning, orderByForgetting, owedNow, PACE_WINDOW_MS, placeReturn,
  planSitting } from './plan.js';
import type { DayPlan } from './plan.js';
import {
  emptyCard, emptyRuleCard, grade, gradeSchedule, isMature, newAllowance, pickRefresher,
  retention, retrievability, scheduler, State,
} from './scheduler.js';
import type { Grade } from './scheduler.js';
import { pullOnOpen } from './sync.js';
import { atMs, before as backFrom, msOf, secOf, WEEK_MS, whenMs } from './units.js';
import type { Millis } from './units.js';

const DAY = 'day';
/** Where the queue was written down before it was derived. Cleared on the way
 *  past, so it is not carried in every export for ever. */
const OLD_SITTING = 'sitting';

/** A sitting, ready for the screen to deal. */
export interface Session {
  items: StudyItem[];
  /** Come back later than the queue is long: the end screen says when. */
  waiting: StudyItem[];
  settings: Settings;
  /** The day in minutes and cards, and the pace behind both. */
  plan: DayPlan;
  /** Milliseconds per answer, for placing a card that comes back mid-sitting. */
  paceMs: number;
  /** Today so far, from the day's record: the tally and the answers, oldest first. */
  done: Tally;
  history: HistoryEntry[];
  /** Something was answered today before this open. */
  resumed: boolean;
  /** The arithmetic behind the queue, for a screen that wants to say it. */
  allowance: number;
  dueCount: number;
  retention7d: number | null;
  introducedToday: number;
}

/** What one answer did, beyond changing the card. */
export interface AnswerResult {
  card: LadderCard;
  justLearned: boolean;
  /** The rung the word climbed to, or null. */
  promoted: Rung | null;
  /** The heard channel opened, because the word was produced aloud. */
  heardOpened: boolean;
  /** The form channel opened, because the verb is now known. */
  formOpened: boolean;
}

/** The cards that can be scheduled: one per word per channel, the highest rung. */
export const sitting = (cards: readonly StoredCard[]): LadderCard[] => cards.filter(isActive);

/** Today's record, or null on a day nothing has been answered yet. Today is
 *  the day that `now` falls in, turning at `dayStartsAt` (Settings), which
 *  the caller passes so that this screen's today is the sitting's. */
export async function todayRecord(now: Date, dayStartsAt: number): Promise<DayRecord | null> {
  const saved = await getMeta<Partial<DayRecord>>(DAY).catch(() => null);
  return sameDay(saved, dayStart(now, dayStartsAt)) ? saved : null;
}

/** Written after every answer. Failure is swallowed: a record that did not
 *  save costs a tally, not an answer. */
export const rememberDay = (state: {
  day: Millis;
  done: Tally;
  history: readonly HistoryEntry[];
}): Promise<void> =>
  setMeta(DAY, dayRecord(state)).then(() => {}, () => {});

/** The items behind a list of ids, in that order.
 *
 *  The card comes from the database where it has one and is made fresh where it
 *  does not — a new word that was dealt but never answered — and the word is
 *  looked up now, so every edit since is on the card. An id that no longer
 *  names a word is left out.
 */
async function itemsForIds(
  ids: readonly string[], mine: ReadonlyMap<WordKey, UserWord>, tenses: readonly string[],
): Promise<StudyItem[]> {
  const items: StudyItem[] = [];
  for (const id of ids) {
    const parsed = parseCardId(id);
    if (!parsed) continue;
    const stored = await getCard(cardId(parsed.key, parsed.channel, parsed.rung));
    /* The id names the channel and the rung, so a row found under it is on
       that rung whatever the row itself carries; a card that was dealt and
       never answered has no row at all and is made fresh. */
    const card: LadderCard = stored
      ? { ...stored, channel: parsed.channel, rung: parsed.rung }
      : emptyCard(parsed.key, parsed.channel, parsed.rung);
    const word = await anyWord(parsed.key, mine);
    if (word) items.push({ kind: 'word', card, word, tenses });
  }
  return items;
}

/** Deal today's sitting, as of `now`. Pulls from the server first, briefly,
 *  where there is one — `pull: false` skips that — then derives the queue.
 *  The same call twice deals the same cards. */
export async function buildSession(
  { now = new Date(), pull = {} }: {
    now?: Date;
    pull?: false | { timeoutMs?: number; fetchImpl?: typeof fetch };
  } = {},
): Promise<Session> {
  void clearMeta(OLD_SITTING).catch(() => {});
  if (pull) await pullOnOpen(pull);
  /* A fortnight of the log, as of `now` and not the wall clock — a sitting
     under an injected clock read an empty log once the two drifted a
     fortnight apart. The pace is measured over that; the week's recall and
     what today has met are read off the week inside it. */
  const [settings, loaded, fortnight, catalogueIndex, own, bits] = await Promise.all([
    getSettings(), allCards(), reviewsSince(backFrom(atMs(now), PACE_WINDOW_MS)), index(),
    activeUserWords(), openBits(),
  ]);
  /* The tenses a verb may be asked in: the ones the learner has opened on
     the Grammar screen. None open, no form card is dealt (grammar/gate.ts). */
  const tenses = openedTenses(bits);
  const weekAgo = atMs(now) - WEEK_MS;
  const recent = fortnight.filter((r) => msOf(r.ts) >= weekAgo);
  const mine = new Map(own.map((w) => [w.k, w]));
  /* A rebuilt catalogue can move a word to another part of speech — "vidéo"
     the adjective becoming "la vidéo". The cards follow, with their state. */
  const stored = await followRenamedWords(loaded, catalogueIndex, mine);
  /* Words that came in by sync or from a Claude conversation get a card now. */
  const everything = [...stored, ...await ensureCards(stored)];
  const cards = sitting(await gateForms(everything, mine, tenses));
  const at = atMs(now);
  const plan = dayPlan({ settings, reviews: fortnight, now });
  const f = scheduler(settings);
  const rOf = (c: LadderCard): number => retrievability(f, c, now);

  /* Your own words never answered, in the order you added them: the
     exploration places are theirs before they are the catalogue's. Once
     answered they are reviews like any other, save that they are never cut. */
  const added = (c: LadderCard): number => mine.get(c.key)?.addedAt ?? Number.MAX_SAFE_INTEGER;
  const ownNew = cards.filter((c) => c.lesson && c.state === State.New)
    .sort((a, b) => added(a) - added(b) || (a.updatedAt ?? 0) - (b.updatedAt ?? 0)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  /* What the day owes — one rule, shared with the home screen (plan.ts). */
  const owed = owedNow(cards, now);
  /* Cards in the middle of being learned — a step of a minute or ten, met
     earlier today or a moment ago. They are dealt where the pace says they
     fall, not sorted in with the reviews: ten minutes past a ten-minute step
     a card is all but certainly still remembered, which would put it last,
     and a step deferred to the bottom of the pile is a step wasted. */
  const returning = owed.filter(isLearning).sort((a, b) => whenMs(a.due) - whenMs(b.due));
  /* The likeliest forgotten first, on FSRS's own curve. */
  const due = orderByForgetting(owed.filter((c) => !isLearning(c)), rOf);

  const retention7d = retention(recent);
  const dueCount = owed.length;
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
    seenBefore: keysAnsweredBefore(everything, dayStart(now, settings.dayStartsAt)),
    dayStartsAt: settings.dayStartsAt,
  }).length;
  /* Once the day's minutes are spent, what is due still comes and the
     catalogue's new words do not. */
  const allowance = plan.spent ? 0
    : newAllowance({ dueCount, retention7d, settings, introducedToday, plan: plan.size });

  /* The index is already in ranked order, so taking from the front is taking
     the easiest useful words that have not been started. A word enters at the
     rung its resemblance to English earns it: "la nation" is read on sight and
     starts by being said; "faire" starts by being recognised. */
  const started = new Set(
    everything.filter((c) => c.channel === 'written' || c.channel === 'sense').map((c) => c.key));
  const fresh: LadderCard[] = [];
  for (const entry of catalogueIndex) {
    if (fresh.length >= allowance) break;
    if (started.has(entry.k)) continue;
    /* On the channel its kind decides: "sur" is met in a sentence, never read
       off an English gloss. */
    const channel = entryChannel(entry);
    fresh.push(emptyCard(entry.k, channel, entryRung(channel, entry), now));
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

  const queue = planSitting({
    capacity: settings.sessionLimit, exploreEvery: settings.exploreEvery,
    due, ownNew, catalogueNew: fresh, refresher,
    isOwn: (c) => !!c.lesson,
  });
  let items: StudyItem[] = await withWords(queue, catalogueIndex, mine, tenses);
  /* The grammar exercises the learner has committed to and owes, dealt
     among the word cards, half a beat off the new words. */
  const drills = await dealDrills(bits, everything, catalogueIndex, mine, now);
  items = interleave(items, drills, settings.exploreEvery);
  const paceMs = plan.paceMs;
  const waiting: StudyItem[] = [];
  /* Latest due first, so that when two are placed at the same spot — two
     overdue steps both belong at the front — the earlier due ends up ahead.
     In due order, each overdue card went in front of the last, and the
     longest-overdue came out last. */
  for (const item of (await withWords(returning, catalogueIndex, mine, tenses)).toReversed()) {
    const placed = placeReturn(items, 0, item, { now: at, paceMs });
    items = placed.queue;
    if (placed.held) waiting.push(item);
  }

  const record = await todayRecord(now, settings.dayStartsAt);
  const ids = [...new Set((record?.history ?? []).map((r) => r.id).filter((id) => !!id))];
  const resolved = new Map<string, StudyItem>((await itemsForIds(ids, mine, tenses)).map((it) => [it.card.id, it]));
  /* A grammar exercise answered today comes back to its own instance, made
     again from the verb's table — the same table, so the same cells. */
  for (const row of record?.history ?? []) {
    if (row.kind !== 'rule' || !row.id || resolved.has(row.id)) continue;
    const item = await drillForId(row.id, mine, now);
    if (item) resolved.set(row.id, item);
  }
  const history = restoreHistory(record?.history, resolved);
  const done = { ...EMPTY_TALLY, ...record?.done };
  return { items, waiting, settings, plan, paceMs, done, history, resumed: history.length > 0,
    allowance, dueCount, retention7d, introducedToday };
}

/** How many exercises one open deals at most: one per rule owed, and no
 *  more than this, so a learner who commits to several bits at once is not
 *  handed a sitting of tables. */
const DRILLS_PER_SITTING = 3;

/** The grammar exercises this open deals: for each committed rule owed, one
 *  table on one of the learner's known verbs (grammar/deal.ts). Nothing
 *  while no bit with a generator is committed, which costs no read. */
async function dealDrills(
  bits: readonly BitState[], cards: readonly StoredCard[], catalogueIndex: readonly IndexEntry[],
  mine: ReadonlyMap<WordKey, UserWord>, now: Date,
): Promise<RuleItem[]> {
  const rules = committed(bits).filter((r) => TABLE_RULE_IDS.includes(r));
  if (!rules.length) return [];
  const [ruleCards, attempts] = await Promise.all([allRuleCards(), allAttempts()]);
  const due = dueRules(rules, ruleCards, now);
  if (!due.length) return [];
  /* The learner's verbs, best known first: a handful of lookups, and the
     level files are the ones the sitting has already fetched. */
  const verbs: StudyWord[] = [];
  for (const key of candidateVerbs(cards, catalogueIndex).slice(0, 12)) {
    const w = await anyWord(key, mine);
    if (w?.conj) verbs.push(w);
  }
  return dealRules({ due, verbs, cards: ruleCards, attempts, limit: DRILLS_PER_SITTING, now });
}

/** The rule item behind an instance id written in the day's record, made
 *  again from the verb's table; null where the id is not a table's, the
 *  verb is gone, or its table no longer fits the rule. */
async function drillForId(
  id: string, mine: ReadonlyMap<WordKey, UserWord>, now: Date,
): Promise<RuleItem | null> {
  const m = /^table:(.+):([a-z]+)$/.exec(id);
  if (!m) return null;
  const word = await anyWord(trustWordKey(m[1]!), mine);
  if (!word) return null;
  const instance = tablesFor(word).find((t) => t.id === id);
  if (!instance) return null;
  const card = (await getRuleCard(ruleCardId(instance.rule, 'produce')))
    ?? emptyRuleCard(instance.rule, 'produce', now);
  return { kind: 'rule', card, instance };
}

async function followRenamedWords(
  cards: readonly StoredCard[], catalogueIndex: readonly IndexEntry[],
  mine: ReadonlyMap<WordKey, UserWord>,
): Promise<StoredCard[]> {
  return persistMoves(cards, rekeyOrphans(cards, catalogueIndex, new Set(mine.keys())));
}

/** Write a set of (old card, moved card) pairs, and return the cards with
 *  the moves applied. A move keeps the card's state under a new id. */
async function persistMoves(
  cards: readonly StoredCard[], moves: readonly [StoredCard, StoredCard][],
): Promise<StoredCard[]> {
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

/** The form cards a sitting may deal, given the tenses the learner has
 *  opened: none while no tense is open; otherwise a which-time card whose
 *  two times are not both open is moved to the voice rung where a form in
 *  an open tense is there to say (ladder.ts `regateForms`), and a form card
 *  that still cannot be asked is left out of the sitting. Left out, not
 *  retired: it is dealt the day its tense is opened. The verbs' tables are
 *  looked up for this, which is a level file or two. */
async function gateForms(
  cards: readonly StoredCard[], mine: ReadonlyMap<WordKey, UserWord>, tenses: readonly string[],
): Promise<StoredCard[]> {
  const forms = cards.filter((c) => c.channel === 'form' && !c.retired);
  if (!forms.length) return [...cards];
  if (!tenses.length) return cards.filter((c) => c.channel !== 'form');
  const words = new Map<WordKey, StudyWord | null>();
  for (const c of forms) {
    if (!words.has(c.key)) words.set(c.key, await anyWord(c.key, mine));
  }
  const wordOf = (key: WordKey): StudyWord | null => words.get(key) ?? null;
  const moved = await persistMoves(cards, regateForms(cards, wordOf, tenses));
  return moved.filter((c) => c.channel !== 'form' || c.retired || askable(c, wordOf(c.key), tenses));
}

/** Pull in the level files the queue needs first, so no card waits on a fetch. */
async function withWords(
  queue: readonly LadderCard[], catalogueIndex: readonly IndexEntry[],
  mine: ReadonlyMap<WordKey, UserWord>, tenses: readonly string[],
): Promise<StudyItem[]> {
  const levelOf = new Map(catalogueIndex.map((w) => [w.k, w.lvl]));
  /* Level 0 is the function words' file, so absent is the test, not falsy. */
  const levels = new Set(
    queue.map((c) => levelOf.get(c.key)).filter((n): n is number => n !== undefined));
  await Promise.all([...levels].map((n) => level(n).catch(() => [])));

  const items: StudyItem[] = [];
  for (const card of queue) {
    const w = await anyWord(card.key, mine);
    if (w) items.push({ kind: 'word', card, word: w, tenses });
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
  { mispronounced = false, tenses }: {
    mispronounced?: boolean;
    /** The tenses the learner has opened, where the caller has them; read
     *  from the bits otherwise. Where a verb's forms enter, and whether. */
    tenses?: readonly string[];
  } = {},
): Promise<AnswerResult> {
  const f = scheduler(settings);
  const opened = tenses ?? openedTenses(await openBits());
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
  const step = afterAnswer({ card: updated, rating, word, cards: rungs, now, tenses: opened });
  if (step.retire) updated.retired = true;
  await putCard(updated);
  for (const made of [step.promoted, step.heard, step.form]) {
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
    formOpened: !!step.form,
  };
}

/** One grammar exercise as it is handed in: what the generator made and
 *  what the learner did with it, before any grade. */
export interface AttemptInput {
  gen: string;
  face: Face;
  spec: unknown;
  instance: string;
  parts: AttemptPart[];
  ms: number | null;
  /** The version of the generator's analyser that labelled the parts. */
  genv: number;
}

export interface AttemptResult {
  attempt: Attempt;
  /** The rule cards as written, one per rule the parts observed. */
  rules: RuleCard[];
  /** The verbs' form cards as written, one per verb whose own forms the
   *  parts observed and that has a form card to grade. */
  forms: LadderCard[];
}

/** Record one grammar exercise: the second write path beside `answer`.
 *
 *  The grades are routed (grammar/grade.ts): each rule the parts observed
 *  gets one grade on the card of the face's mode, made on the spot if the
 *  rule has never been asked, and each verb whose irregular form was
 *  observed gets one on its existing form card — not on a card of its own,
 *  and without climbing the form ladder, which the form card's own answers
 *  do. A verb with no form card yet is evidence kept in the attempt alone.
 *  The attempt is logged whole, with the grade every card actually got, so
 *  the day's grading can be read back whatever a later analyser makes of
 *  the parts. No review row is written: the attempt is the grammar's log,
 *  and the progress screens read it as such. */
export async function recordAttempt(
  input: AttemptInput, settings: Settings, now: Date = new Date(),
): Promise<AttemptResult> {
  const f = scheduler(settings);
  const mode = FACE_MODE[input.face];
  /* The streak a rule's grade reads is on its card, so the cards come
     first: routed once to learn which, then once more with what they say. */
  const wanted = routeGrades(input.parts, mode).rules.map((r) => r.id);
  const stored = new Map<string, RuleCard>();
  for (const id of wanted) {
    const c = await getRuleCard(id);
    if (c) stored.set(id, c);
  }
  const routing = routeGrades(input.parts, mode, (id) => stored.get(id)?.streak ?? 0);

  const grades: Record<string, Grade> = {};
  const rules: RuleCard[] = [];
  for (const { id, rule, rating } of routing.rules) {
    const before = stored.get(id) ?? emptyRuleCard(rule, mode, now);
    const updated = gradeSchedule(f, before, rating, now);
    updated.updatedAt = atMs(now);
    updated.streak = streakAfter(before, rating);
    await putRuleCard(updated);
    grades[id] = rating;
    rules.push(updated);
  }

  const forms: LadderCard[] = [];
  for (const { key, rating } of routing.items) {
    const form = (await cardsFor(key)).filter(isActive).find((c) => c.channel === 'form');
    if (!form) continue;
    const updated = grade(f, form, rating, now, settings);
    updated.updatedAt = atMs(now);
    updated.streak = streakAfter(form, rating);
    await putCard(updated);
    grades[updated.id] = rating;
    forms.push(updated);
  }

  const attempt: Attempt = {
    uid: crypto.randomUUID(),
    ts: secOf(atMs(now)),
    ms: input.ms,
    gen: input.gen,
    face: input.face,
    spec: input.spec,
    instance: input.instance,
    parts: input.parts,
    grades,
    v: ATTEMPT_V,
    genv: input.genv,
  };
  await logAttempt(attempt);
  return { attempt, rules, forms };
}
