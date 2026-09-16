/** What Claude can do with the word list, and how each thing answers.
 *
 *  Six tools, one job each. Additions, corrections and removals are separate
 *  tools rather than one "change" call: they differ in what can go wrong —
 *  only an addition can be a duplicate, only a removal is destructive — and a
 *  removal buried in a list of additions is a mistake nobody sees. Within a
 *  tool the words come as a list, so a lesson is one call and one sequence
 *  of writes, and every row is answered on its own: rows that were clear are
 *  written, rows that were not come back with their candidates and nothing
 *  written, and the caller sends those again once someone has decided.
 *
 *  Every answer is the same object twice, as text for the model to read and
 *  as `structuredContent` for a client that keeps data, with one sentence in
 *  front saying what happened. Keys are always shown, because a key is what
 *  the next call takes.
 */
import { trustWordKey, userKey } from '../../../app/src/lib/keys.js';
import type { WordKey } from '../../../app/src/lib/keys.js';
import { statusOf } from '../../../app/src/lib/ladder.js';
import type { WordStatus } from '../../../app/src/lib/ladder.js';
import type { Gender, GrammaticalNumber, StoredCard, UserWord } from '../../../app/src/lib/model.js';
import type { Millis } from '../../../app/src/lib/units.js';
import { queryOf, score, shardOf } from '../../../app/src/lib/wordsearch.js';
import type { Catalogue } from '../catalogue.js';
import { normalisePos, posOf, resolveAdditions, resolveEdit } from '../resolve.js';
import type { Change, Context, Proposal, Resolution } from '../resolve.js';
import type { WordStore } from '../wordstore.js';
import { argsOf, bool, int, obj, objList, oneOf, str, strList } from './args.js';
import type { JsonSchema, ServerInfo, ToolDef, ToolResult } from './protocol.js';

/** What every tool is given: the account's store, the catalogue, the clock. */
export interface ToolContext {
  store: WordStore;
  catalogue: Catalogue;
  now(): Millis;
}

export const SERVER_INFO: ServerInfo = {
  name: 'learness',
  title: 'Learness word list',
  version: '2.0.0',
  icon: '/icon-maskable.svg',
  instructions: [
    'You are connected to one learner\'s French word list in Learness, a spaced-repetition app.',
    'Words you add appear on their devices at the next sync and go to the front of the next sitting.',
    'Before adding, prefer search_words to see whether a word is already in the list, taught by',
    'the catalogue, or known to the dictionary. add_words does that check itself for every row:',
    'a word the catalogue teaches is promoted under the catalogue\'s key (audio and tables come',
    'with it); a word only the dictionary knows arrives with its gender and transcription; a word',
    'that might already be there comes back as a "conflict" with candidates and nothing written.',
    'Resolve a conflict by sending the row again with resolve.use = a candidate\'s key (it is that',
    'word) or resolve.force = true (it is a word of its own) — ask the learner when the candidates',
    'do not settle it. Keys ("lemma|pos") are identities: update_words keeps them, so cards and',
    'history stay. You cannot see the review log, only where each word stands.',
  ].join(' '),
};

const GENDERS: readonly Gender[] = ['m', 'f', 'mf'];
const NUMBERS: readonly GrammaticalNumber[] = ['pl'];

/* --------------------------------------------------------------- shapes -- */

const WORD_FIELDS: JsonSchema = {
  fr: { type: 'string', description: 'The French, with its article for a noun: "le natel", "l\'école".' },
  en: { type: 'array', items: { type: 'string' },
    description: 'English glosses, the one the learner met first. A single string is accepted too.' },
  pos: { type: 'string', description: 'Part of speech: noun, verb, adj, adv, prep, conj, pron, phrase, other. Leave out if unsure.' },
  gender: { type: 'string', enum: GENDERS, description: 'For a noun: m, f, or mf for a noun of either gender.' },
  number: { type: 'string', enum: NUMBERS, description: '"pl" for a noun taught in the plural: "les gens".' },
  note: { type: 'string', description: 'A usage note shown on the card: register, region, a fixed phrase.' },
};
const RESOLVE_FIELD: JsonSchema = {
  resolve: {
    type: 'object',
    description: 'How to settle a conflict this row came back with. Send only after a conflict.',
    properties: {
      use: { type: 'string', description: 'The key of the candidate this word is. An existing word is updated in place; a catalogue word is promoted; a dictionary word is taken.' },
      force: { type: 'boolean', description: 'Add it as a word of its own, or overwrite the existing word under the same key, whatever the candidates.' },
    },
  },
};

const CANDIDATE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    source: { type: 'string', enum: ['mine', 'catalogue', 'dictionary'] },
    key: { type: 'string' }, fr: { type: 'string' }, en: { type: 'array', items: { type: 'string' } },
    pos: { type: 'string' }, gender: { type: 'string' }, status: { type: 'string' },
    relation: { type: 'string' },
  },
  required: ['source', 'key', 'fr', 'en', 'pos', 'status', 'relation'],
};

/* -------------------------------------------------------------- helpers -- */

const answer = (summary: string, structured: Record<string, unknown>, isError = false): ToolResult =>
  ({ text: `${summary}\n${JSON.stringify(structured, null, 2)}`, structured, isError });

/** A word of the learner's, as every tool shows one. `source` is always
 *  "mine": a word shown here is in the list, whatever it came from, and
 *  "mine" is the word the tool descriptions and the candidates use for that.
 *  Where it came from is `origin`: "catalogue" for a word promoted from the
 *  catalogue (its audio and tables come with it), "app" for one of the
 *  learner's own. The two were one key once, and the record's own value won
 *  over the "mine" spread before it: search showed a list word as
 *  "catalogue", Claude took that to mean it was not in the list, and
 *  add_words answered "unchanged" to a word it had just been shown. */
function shown(w: UserWord, cards: readonly StoredCard[], now: Millis): Record<string, unknown> {
  return {
    source: 'mine',
    origin: w.source ?? 'app',
    key: w.k, fr: w.fr, en: w.en, pos: w.pos,
    ...(w.gender ? { gender: w.gender } : {}),
    ...(w.number ? { number: w.number } : {}),
    ...(w.ipa ? { ipa: w.ipa } : {}),
    ...(w.note ? { note: w.note } : {}),
    ...(w.lesson ? { lesson: w.lesson } : {}),
    status: w.deleted ? 'removed' : statusOf(w.k, cards, new Date(now)),
    ...(w.addedAt ? { addedAt: new Date(w.addedAt).toISOString() } : {}),
  };
}

/** Everything a decision is made against, fetched once per call. The
 *  dictionary shards are fetched for the letters in the batch only. */
async function contextFor(
  ctx: ToolContext, frs: readonly string[], lesson?: string,
): Promise<Context & { notes: string[] }> {
  const [mine, cards, catalogue] = await Promise.all([
    ctx.store.words({ includeDeleted: true }), ctx.store.cards(), ctx.catalogue.index(),
  ]);
  const letters = [...new Set(frs.map(shardOf))];
  const shards = new Map(await Promise.all(letters.map(async (l) =>
    [l, await ctx.catalogue.dictionary(l)] as const)));
  const notes: string[] = [];
  if (catalogue === null) notes.push('The catalogue could not be read; words were checked against your list and the dictionary only.');
  const context: Context = {
    mine, cards, catalogue, now: ctx.now(),
    dictionary: (letter) => shards.get(letter) ?? null,
  };
  if (lesson) context.lesson = lesson;
  return { ...context, notes };
}

const readProposal = (item: Record<string, unknown>): Proposal => {
  const p: Proposal = { fr: str(item, 'fr', { required: true }), en: strList(item, 'en') };
  const pos = str(item, 'pos');
  const gender = oneOf(item, 'gender', GENDERS);
  const number = oneOf(item, 'number', NUMBERS);
  const note = str(item, 'note');
  const resolve = obj(item, 'resolve');
  if (pos) p.pos = pos;
  if (gender) p.gender = gender;
  if (number) p.number = number;
  if (note) p.note = note;
  if (Object.keys(resolve).length) {
    p.resolve = {};
    const use = str(resolve, 'use');
    if (use) p.resolve.use = use;
    if (bool(resolve, 'force')) p.resolve.force = true;
  }
  return p;
};

/** One row of add_words' answer: the outcome, flattened for reading. */
function rowOf(r: Resolution): Record<string, unknown> {
  const o = r.outcome;
  const base: Record<string, unknown> = { index: r.index, fr: r.proposal.fr, action: o.action };
  if (o.action === 'add') {
    return { ...base, key: o.record.k, ...(o.from ? { from: o.from } : {}),
      ...(o.restored ? { restored: true } : {}), record: o.record, related: r.related, notes: r.notes };
  }
  if (o.action === 'promote') {
    return { ...base, key: o.record.k, was: o.was, record: o.record, related: r.related, notes: r.notes };
  }
  if (o.action === 'update') {
    return { ...base, key: o.record.k, changed: o.changed, record: o.record, notes: r.notes };
  }
  if (o.action === 'unchanged') return { ...base, key: o.record.k, notes: r.notes };
  if (o.action === 'merged') return { ...base, into: o.into };
  if (o.action === 'conflict') {
    return { ...base, candidates: o.candidates, hint: o.hint, related: r.related, notes: r.notes };
  }
  return { ...base, reason: o.reason };
}

/* ---------------------------------------------------------------- tools -- */

const searchWords: ToolDef<ToolContext> = {
  name: 'search_words',
  title: 'Search the list, the catalogue and the dictionary',
  description: 'Find a French or English word across three places: the learner\'s own list (source '
    + '"mine", with where each word stands and its origin: "catalogue" if it was promoted from the '
    + 'catalogue, "app" if it is their own), the catalogue the app teaches from ("catalogue": '
    + 'scheduled or not yet), and the dictionary of words the catalogue passed over ("dictionary", '
    + 'French only). A word with source "mine" is already in the list: do not add it again. Use it '
    + 'to see what exists before adding, or to find a key for update_words.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A French word (article optional) or an English gloss.' },
      limit: { type: 'number', description: 'Most hits per source, 1 to 25. Default 8.' },
    },
    required: ['query'],
  },
  annotations: { readOnlyHint: true },
  async run(raw, ctx) {
    const a = argsOf(raw);
    const query = str(a, 'query', { required: true });
    const limit = int(a, 'limit', { min: 1, max: 25, fallback: 8 });
    const q = queryOf(query);
    const now = ctx.now();
    const [mine, cards, index, shard] = await Promise.all([
      ctx.store.words(), ctx.store.cards(), ctx.catalogue.index(), ctx.catalogue.dictionary(shardOf(query)),
    ]);
    const rank = <T>(items: readonly T[], of: (t: T) => { fr: string; en: readonly string[] }): T[] =>
      items.map((t) => ({ t, s: score(q, of(t).fr, of(t).en) })).filter((x) => x.s > 0)
        .sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.t);
    const mineHits = rank(mine, (w) => w).map((w) => shown(w, cards, now));
    const mineKeys = new Set(mine.map((w) => w.k));
    const catalogueHits = index === null ? null : rank(index.filter((e) => !mineKeys.has(e.k)), (e) => e)
      .map((e) => {
        const status: WordStatus | 'not scheduled' = statusOf(e.k, cards, new Date(now)) === 'not started'
          ? 'not scheduled' : statusOf(e.k, cards, new Date(now));
        return { source: 'catalogue', key: e.k, fr: e.fr, en: e.en, pos: posOf(e.k), level: e.lvl, status };
      });
    const dictionaryHits = shard === null ? null
      : rank(shard.filter((d) => !mineKeys.has(userKey(d.fr, d.pos))), (d) => d)
        .map((d) => {
          const hit: Record<string, unknown> = { source: 'dictionary', key: userKey(d.fr, d.pos),
            fr: d.fr, en: d.en, pos: d.pos };
          if (d.gender) hit.gender = d.gender;
          if (d.ipa) hit.ipa = d.ipa;
          return hit;
        });
    const notes: string[] = [];
    if (catalogueHits === null) notes.push('The catalogue could not be read.');
    if (dictionaryHits === null) notes.push('No dictionary is shipped, or it could not be read; it answers French queries only.');
    const total = mineHits.length + (catalogueHits?.length ?? 0) + (dictionaryHits?.length ?? 0);
    return answer(`${total} hit${total === 1 ? '' : 's'} for "${query}".`, {
      query, mine: mineHits, catalogue: catalogueHits ?? [], dictionary: dictionaryHits ?? [], notes,
    });
  },
};

const listWords: ToolDef<ToolContext> = {
  name: 'list_words',
  title: 'List the learner\'s own words',
  description: 'Every word the learner added or promoted, with its key, where it stands ("not started", '
    + '"up next", "learning", "due" or "known") and its origin ("catalogue" if promoted from the '
    + 'catalogue, "app" if their own). Not the catalogue: use search_words for that.',
  inputSchema: {
    type: 'object',
    properties: {
      lesson: { type: 'string', description: 'Only words added under this lesson label.' },
      includeRemoved: { type: 'boolean', description: 'Also list words that were removed (status "removed").' },
    },
  },
  annotations: { readOnlyHint: true },
  async run(raw, ctx) {
    const a = argsOf(raw);
    const lesson = str(a, 'lesson');
    const includeDeleted = bool(a, 'includeRemoved');
    const now = ctx.now();
    const [words, cards] = await Promise.all([ctx.store.words({ includeDeleted }), ctx.store.cards()]);
    const rows = words.filter((w) => !lesson || w.lesson === lesson).map((w) => shown(w, cards, now));
    return answer(`${rows.length} word${rows.length === 1 ? '' : 's'}${lesson ? ` under "${lesson}"` : ''}.`,
      { words: rows });
  },
};

const addWords: ToolDef<ToolContext> = {
  name: 'add_words',
  title: 'Add words from a lesson',
  description: 'Add words to the learner\'s list. Each row is checked against the list, the catalogue '
    + 'and the dictionary first, and answered on its own: "add" (a word of their own), "promote" '
    + '(the catalogue teaches it; its key, audio and tables are used), "update" (already there, '
    + 'glosses merged), "unchanged", "merged" (offered twice in this call), or "conflict" — the word '
    + 'may already exist, here are the candidates, and NOTHING was written for that row. Settle a '
    + 'conflict by sending that row again with resolve.use (a candidate\'s key) or resolve.force. '
    + 'Rows that were clear are written even when others conflict; dryRun answers without writing.',
  inputSchema: {
    type: 'object',
    properties: {
      words: { type: 'array', minItems: 1, maxItems: 200, items: {
        type: 'object', properties: { ...WORD_FIELDS, ...RESOLVE_FIELD }, required: ['fr'],
      } },
      lesson: { type: 'string', description: 'A label for where these came from: "Tuesday with Marie". Shown on the words and the cards.' },
      dryRun: { type: 'boolean', description: 'Decide and report, write nothing.' },
    },
    required: ['words'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      written: { type: 'number' },
      dryRun: { type: 'boolean' },
      results: { type: 'array', items: { type: 'object', properties: {
        index: { type: 'number' }, fr: { type: 'string' },
        action: { type: 'string', enum: ['add', 'promote', 'update', 'unchanged', 'merged', 'conflict', 'invalid'] },
        key: { type: 'string' }, candidates: { type: 'array', items: CANDIDATE_SCHEMA },
        hint: { type: 'string' }, reason: { type: 'string' },
      }, required: ['index', 'fr', 'action'] } },
      notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['written', 'results', 'notes'],
  },
  async run(raw, ctx) {
    const a = argsOf(raw);
    const proposals = objList(a, 'words', readProposal);
    const lesson = str(a, 'lesson');
    const dryRun = bool(a, 'dryRun');
    const { notes, ...context } = await contextFor(ctx, proposals.map((p) => p.fr), lesson || undefined);
    const results = resolveAdditions(proposals, context);
    const toWrite: UserWord[] = [];
    for (const r of results) {
      const o = r.outcome;
      if (o.action === 'add' || o.action === 'promote' || o.action === 'update') toWrite.push(o.record);
    }
    const written = dryRun ? 0 : await ctx.store.put(toWrite);
    const count = (action: string): number => results.filter((r) => r.outcome.action === action).length;
    const parts = [
      `${dryRun ? 'Would write' : 'Wrote'} ${toWrite.length} word${toWrite.length === 1 ? '' : 's'}`,
      count('promote') ? `${count('promote')} promoted from the catalogue` : '',
      count('conflict') ? `${count('conflict')} conflict${count('conflict') === 1 ? '' : 's'} left unwritten` : '',
      count('unchanged') ? `${count('unchanged')} already there` : '',
      count('invalid') ? `${count('invalid')} invalid` : '',
    ].filter(Boolean);
    return answer(`${parts.join('; ')}.`, { written, dryRun, results: results.map(rowOf), notes });
  },
};

const updateWords: ToolDef<ToolContext> = {
  name: 'update_words',
  title: 'Correct words already in the list',
  description: 'Change the French, glosses, part of speech, gender, number, note or lesson of words '
    + 'already in the list, by key. The key never changes, so the word keeps its cards and history '
    + '— correcting "une erreur" to "l\'erreur" does not start it over. Glosses given replace the '
    + 'old ones. A new spelling that is another word in the list or the catalogue comes back as a '
    + '"conflict" with nothing written; resolve.force writes it anyway.',
  inputSchema: {
    type: 'object',
    properties: {
      changes: { type: 'array', minItems: 1, maxItems: 200, items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The word\'s key, from list_words or search_words: "natel|noun".' },
          ...WORD_FIELDS,
          lesson: { type: 'string' },
          ...RESOLVE_FIELD,
        },
        required: ['key'],
      } },
      dryRun: { type: 'boolean' },
    },
    required: ['changes'],
  },
  async run(raw, ctx) {
    const a = argsOf(raw);
    const changes = objList(a, 'changes', (item): Change => {
      const c: Change = { key: str(item, 'key', { required: true }) };
      const fr = str(item, 'fr');
      if (fr) c.fr = fr;
      if (item.en !== undefined) c.en = strList(item, 'en');
      const pos = str(item, 'pos');
      if (pos) c.pos = pos;
      const gender = oneOf(item, 'gender', GENDERS);
      if (gender) c.gender = gender;
      const number = oneOf(item, 'number', NUMBERS);
      if (number) c.number = number;
      if (item.note !== undefined) c.note = str(item, 'note');
      if (item.lesson !== undefined) c.lesson = str(item, 'lesson');
      if (bool(obj(item, 'resolve'), 'force')) c.resolve = { force: true };
      return c;
    });
    const dryRun = bool(a, 'dryRun');
    const { notes, ...context } = await contextFor(ctx, changes.map((c) => c.fr ?? ''));
    const outcomes = changes.map((c) => ({ change: c, outcome: resolveEdit(c, context) }));
    const toWrite = outcomes.flatMap(({ outcome: o }) => o.action === 'update' ? [o.record] : []);
    const written = dryRun ? 0 : await ctx.store.put(toWrite);
    const results = outcomes.map(({ change, outcome: o }): Record<string, unknown> => {
      const base = { key: change.key, action: o.action };
      if (o.action === 'update') return { ...base, changed: o.changed, record: o.record };
      if (o.action === 'missing') return { ...base, reason: 'no word in the list has this key; see list_words' };
      if (o.action === 'conflict') return { ...base, candidates: o.candidates, hint: o.hint };
      return base;
    });
    const conflicts = outcomes.filter((x) => x.outcome.action === 'conflict').length;
    const missing = outcomes.filter((x) => x.outcome.action === 'missing').length;
    const parts = [
      `${dryRun ? 'Would change' : 'Changed'} ${toWrite.length} word${toWrite.length === 1 ? '' : 's'}`,
      conflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'} left unwritten` : '',
      missing ? `${missing} key${missing === 1 ? '' : 's'} not found` : '',
    ].filter(Boolean);
    return answer(`${parts.join('; ')}.`, { written, dryRun, results, notes });
  },
};

const removeWords: ToolDef<ToolContext> = {
  name: 'remove_words',
  title: 'Remove words from the list',
  description: 'Take words off the learner\'s list, by key. The removal travels to their devices. '
    + 'The cards of a word the catalogue also teaches are kept, since it is still in the ranking; '
    + 'a word of their own loses its cards on the device. Ask before removing anything with a status '
    + 'other than "not started" or "up next".',
  inputSchema: {
    type: 'object',
    properties: {
      keys: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string' },
        description: 'Keys from list_words or search_words.' },
    },
    required: ['keys'],
  },
  annotations: { destructiveHint: true, idempotentHint: true },
  async run(raw, ctx) {
    const a = argsOf(raw);
    const keys = strList(a, 'keys');
    if (!keys.length) return answer('No keys were given.', { removed: [], missing: [] }, true);
    const mine = await ctx.store.words();
    const now = ctx.now();
    const found: UserWord[] = [];
    const missing: string[] = [];
    for (const given of keys) {
      const key: WordKey = trustWordKey(given);
      const w = mine.find((x) => x.k === key);
      if (w) found.push({ ...w, deleted: true, updatedAt: now });
      else missing.push(given);
    }
    await ctx.store.put(found);
    return answer(`Removed ${found.length} word${found.length === 1 ? '' : 's'}`
      + `${missing.length ? `; ${missing.length} not in the list` : ''}.`,
      { removed: found.map((w) => ({ key: w.k, fr: w.fr })), missing });
  },
};

const getProgress: ToolDef<ToolContext> = {
  name: 'get_progress',
  title: 'Progress, in counts',
  description: 'How many words the learner holds, how many cards are scheduled, how many reviews '
    + 'and lessons exist. Counts only: the review log itself is not readable here.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  async run(_raw, ctx) {
    const counts = await ctx.store.counts();
    const mine = await ctx.store.words();
    const cards = await ctx.store.cards();
    const now = new Date(ctx.now());
    const byStatus: Record<string, number> = {};
    for (const w of mine) {
      const s = statusOf(w.k, cards, now);
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }
    return answer(`${counts.words} words of their own, ${counts.cards} cards, ${counts.reviews} reviews, `
      + `${counts.lessons} lessons.`, { ...counts, ownWordsByStatus: byStatus });
  },
};

export const TOOLS: readonly ToolDef<ToolContext>[] = [
  searchWords, listWords, addWords, updateWords, removeWords, getProgress,
];

/* normalisePos is applied inside the resolver; it is re-exported so a test of
   the tools can say what a part of speech becomes. */
export { normalisePos };
