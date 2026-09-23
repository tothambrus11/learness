/** The connector, spoken to as Claude speaks to it.
 *
 *  JSON-RPC over POST /mcp, through the Worker, against a real database and
 *  the pipeline's fixture catalogue. The tools are exercised the way a
 *  conversation goes: search, add a lesson, meet a conflict, settle it,
 *  correct a word, remove one. What the learner sees on the phone follows
 *  from the rows these leave behind, which is why every row is checked.
 */
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { forgetCatalogue } from '../src/catalogue.js';
import { LATEST_PROTOCOL } from '../src/mcp/protocol.js';
import { harness } from './env.js';
import type { Harness } from './env.js';

beforeEach(() => forgetCatalogue());

interface Rpc { jsonrpc: '2.0'; id: number; result?: Record<string, unknown>; error?: { code: number; message: string } }

/** A signed-in connector: an account, a words-scoped token, and a way to
 *  call a tool and read its structured answer. */
async function connect(over: { catalogue?: boolean } = {}) {
  const h = harness(over);
  const { token, userId } = await h.signIn('learner@example.com', 'words');
  let id = 0;
  const rpc = async (method: string, params?: unknown): Promise<Rpc> => {
    const res = await h.fetch('/mcp', { method: 'POST', token,
      json: { jsonrpc: '2.0', id: ++id, method, ...(params === undefined ? {} : { params }) } });
    assert.equal(res.status, 200, `${method}: ${res.status}`);
    return (await res.json()) as Rpc;
  };
  const call = async <T = Record<string, unknown>>(name: string, args: unknown = {}): Promise<T> => {
    const r = await rpc('tools/call', { name, arguments: args });
    assert.ok(r.result, `${name}: ${JSON.stringify(r.error)}`);
    assert.equal(r.result.isError, false, `${name} failed: ${JSON.stringify(r.result.content)}`);
    return r.result.structuredContent as T;
  };
  return { h, token, userId, rpc, call };
}

const rows = async (h: Harness, userId: string, table = 'words'): Promise<Record<string, unknown>[]> =>
  (await h.env.DB.prepare(`SELECT data, deleted FROM ${table} WHERE user_id = ? ORDER BY seq`).bind(userId)
    .all<{ data: string }>()).results.map((r) => JSON.parse(r.data) as Record<string, unknown>);

interface Result { index: number; fr: string; action: string; key?: string; candidates?: { key: string; relation: string; source: string; status: string }[]; from?: string; was?: string; changed?: string[]; into?: number }
interface Added { written: number; dryRun: boolean; results: Result[]; notes: string[] }

test('the handshake says which protocol it speaks and what the tools are', async () => {
  const { rpc } = await connect();
  const init = await rpc('initialize', { protocolVersion: '2025-06-18',
    capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result!.protocolVersion, '2025-06-18', 'a version it speaks is echoed');
  assert.deepEqual(init.result!.capabilities, { tools: { listChanged: false } });
  assert.match(String(init.result!.instructions), /resolve\.use/);
  /* The icon a client shows for the connector is the full-bleed one, on this
     server's own origin: the rounded one came out with white corners (#50). */
  const info = init.result!.serverInfo as { icons: { src: string; mimeType: string }[] };
  assert.equal(info.icons.length, 1);
  assert.match(info.icons[0]!.src, /^https?:\/\/[^/]+\/icon-maskable\.svg$/);
  assert.equal(info.icons[0]!.mimeType, 'image/svg+xml');
  const future = await rpc('initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: {} });
  assert.equal(future.result!.protocolVersion, LATEST_PROTOCOL, 'an unknown version gets the newest');
  const list = await rpc('tools/list');
  const tools = list.result!.tools as { name: string; inputSchema: { type: string } }[];
  assert.deepEqual(tools.map((t) => t.name),
    ['search_words', 'list_words', 'add_words', 'update_words', 'remove_words', 'get_progress']);
  assert.ok(tools.every((t) => t.inputSchema.type === 'object'));
  const missing = await rpc('nothing/here');
  assert.equal(missing.error?.code, -32601);
  const unknown = await rpc('tools/call', { name: 'no_such_tool', arguments: {} });
  assert.equal(unknown.error?.code, -32602);
});

test('a notification is accepted with nothing to say; a broken body is refused', async () => {
  const { h, token } = await connect();
  const note = await h.fetch('/mcp', { method: 'POST', token,
    json: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(note.status, 202);
  const broken = await h.fetch('/mcp', { method: 'POST', token, body: '{not json',
    headers: { 'content-type': 'application/json' } });
  assert.equal(broken.status, 400);
  assert.equal((await broken.json<Rpc>()).error?.code, -32700);
  const get = await h.fetch('/mcp', { token });
  assert.equal(get.status, 405, 'no stream to open: every answer is in the POST');
  /* A batch from a client on the older revision is answered as a batch. */
  const batch = await h.fetch('/mcp', { method: 'POST', token,
    json: [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }] });
  assert.deepEqual(await batch.json(), [
    { jsonrpc: '2.0', id: 1, result: {} }, { jsonrpc: '2.0', id: 2, result: {} }]);
});

test('bad arguments are a protocol error that names the argument', async () => {
  const { rpc } = await connect();
  const r = await rpc('tools/call', { name: 'add_words', arguments: { words: [{ en: ['x'] }] } });
  assert.equal(r.error?.code, -32602);
  assert.match(r.error?.message ?? '', /fr is required/);
  const r2 = await rpc('tools/call', { name: 'add_words', arguments: { words: [{ fr: 'x', gender: 'n' }] } });
  assert.match(r2.error?.message ?? '', /gender must be one of/);
  const r3 = await rpc('tools/call', { name: 'search_words', arguments: {} });
  assert.match(r3.error?.message ?? '', /query is required/);
});

test('a lesson is added in one call: promoted, filled in, made your own, each row answered', async () => {
  const { h, userId, call } = await connect();
  const out = await call<Added>('add_words', { lesson: 'Tuesday', words: [
    { fr: 'le train', en: 'train, railway train' },        /* the catalogue teaches it */
    { fr: 'chaussette', en: ['sock'] },                     /* only the dictionary knows it */
    { fr: 'le natel', en: ['mobile phone'], pos: 'noun', gender: 'm', note: 'Swiss' },
    { fr: 'natel', en: ['cell phone'] },                    /* the same word, again */
  ] });
  assert.equal(out.written, 3);
  assert.deepEqual(out.results.map((r) => [r.action, r.key]), [
    ['promote', 'train|noun'], ['add', 'la chaussette|noun'], ['add', 'le natel|noun'], ['merged', undefined],
  ]);
  assert.equal(out.results[0]!.was, 'in the catalogue, not scheduled');
  assert.equal(out.results[1]!.from, 'dictionary');
  assert.equal(out.results[3]!.into, 2);

  const stored = await rows(h, userId);
  assert.deepEqual(stored.map((w) => w.k), ['train|noun', 'la chaussette|noun', 'le natel|noun']);
  const train = stored[0]!;
  assert.equal(train.source, 'catalogue', 'as the app promotes it, so its audio is found');
  assert.equal(train.fr, 'le train');
  assert.deepEqual(train.en, ['train', 'railway train']);
  assert.equal(train.lesson, 'Tuesday');
  const sock = stored[1]!;
  assert.equal(sock.gender, 'f');
  assert.equal(sock.ipa, '/ʃo.sɛt/');
  const natel = stored[2]!;
  assert.deepEqual(natel.en, ['mobile phone', 'cell phone']);
  assert.equal(natel.note, 'Swiss');
  assert.equal(typeof natel.updatedAt, 'number');

  const listed = await call<{ words: { key: string; status: string; lesson?: string }[] }>('list_words',
    { lesson: 'Tuesday' });
  assert.equal(listed.words.length, 3);
  assert.ok(listed.words.every((w) => w.status === 'not started'), 'no device has made a card yet');
});

test('a duplicate comes back as candidates, nothing is written, and the retry settles it', async () => {
  const { h, userId, call } = await connect();
  /* What the first connector left behind: the catalogue's word under the typed key. */
  await h.env.DB.prepare(
    `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,0,1)`)
    .bind(userId, 'le train|noun', JSON.stringify({ k: 'le train|noun', fr: 'le train', en: 'train',
      pos: 'noun', source: 'mcp', updatedAt: 1 }), 1).run();

  const out = await call<Added>('add_words', { words: [{ fr: 'train', en: ['train'] }] });
  assert.equal(out.written, 0);
  const row = out.results[0]!;
  assert.equal(row.action, 'conflict');
  assert.deepEqual(row.candidates!.map((c) => [c.source, c.key, c.relation]), [
    ['mine', 'le train|noun', 'same word'],
    ['catalogue', 'train|noun', 'same word'],
  ]);
  assert.equal((await rows(h, userId)).length, 1, 'nothing written');

  /* The agent decides: it is the catalogue's word. */
  const used = await call<Added>('add_words', { words: [
    { fr: 'train', en: ['train'], resolve: { use: 'train|noun' } }] });
  assert.deepEqual(used.results.map((r) => [r.action, r.key]), [['promote', 'train|noun']]);
  assert.equal(used.written, 1);
  /* ...and tidies the old copy away. */
  const removed = await call<{ removed: { key: string }[]; missing: string[] }>('remove_words',
    { keys: ['le train|noun', 'nothing|noun'] });
  assert.deepEqual(removed.removed.map((r) => r.key), ['le train|noun']);
  assert.deepEqual(removed.missing, ['nothing|noun']);
  const all = await rows(h, userId);
  /* Newest write last: the removal re-sequenced the old copy. */
  assert.deepEqual(all.map((w) => [w.k, w.deleted ?? false]), [['train|noun', false], ['le train|noun', true]]);
  assert.equal((await call<{ words: unknown[] }>('list_words')).words.length, 1);
  assert.equal((await call<{ words: unknown[] }>('list_words', { includeRemoved: true })).words.length, 2);

  /* Or: it is a word of its own, forced. */
  const forced = await call<Added>('add_words', { words: [
    { fr: 'marche', en: ['walk!'], pos: 'verb', resolve: { force: true } }] });
  assert.deepEqual(forced.results.map((r) => [r.action, r.key]), [['add', 'marche|verb']]);
});

test('a dry run decides everything and writes nothing', async () => {
  const { h, userId, call } = await connect();
  const out = await call<Added>('add_words', { dryRun: true, words: [{ fr: 'le train', en: ['train'] }] });
  assert.equal(out.dryRun, true);
  assert.equal(out.written, 0);
  assert.equal(out.results[0]!.action, 'promote');
  assert.deepEqual(await rows(h, userId), []);
});

test('the same word offered again is a decision, not a silent overwrite', async () => {
  const { call } = await connect();
  await call<Added>('add_words', { words: [{ fr: 'le natel', en: ['mobile phone'], pos: 'noun' }] });
  const same = await call<Added>('add_words', { words: [{ fr: 'le natel', en: ['mobile phone'], pos: 'noun' }] });
  assert.equal(same.results[0]!.action, 'unchanged');
  const differs = await call<Added>('add_words', { words: [{ fr: 'le natel', en: ['cell phone'], pos: 'noun' }] });
  assert.equal(differs.results[0]!.action, 'conflict');
  assert.deepEqual(differs.results[0]!.candidates!.map((c) => c.relation), ['same key']);
  const merged = await call<Added>('add_words', { words: [
    { fr: 'le natel', en: ['cell phone'], pos: 'noun', resolve: { use: 'le natel|noun' } }] });
  assert.equal(merged.results[0]!.action, 'update');
  assert.deepEqual(merged.results[0]!.changed, ['en']);
});

test('where a word stands is read off the learner\'s cards, never the review log', async () => {
  const { h, userId, call } = await connect();
  await call<Added>('add_words', { words: [{ fr: 'le natel', en: ['phone'], pos: 'noun' }] });
  /* A device studied it: its written card is in review with a long memory. */
  const card = { id: 'le natel|noun|written|recognise', key: 'le natel|noun', channel: 'written',
    rung: 'recognise', state: 2, stability: 45, difficulty: 5, due: new Date(Date.now() + 864e5 * 30).toISOString(),
    elapsed_days: 0, scheduled_days: 30, learning_steps: 0, reps: 8, lapses: 0 };
  await h.env.DB.prepare('INSERT INTO cards (user_id, id, data, updatedAt, seq) VALUES (?,?,?,?,9)')
    .bind(userId, card.id, JSON.stringify(card), Date.now()).run();
  const listed = await call<{ words: { key: string; status: string }[] }>('list_words');
  assert.deepEqual(listed.words.map((w) => [w.key, w.status]), [['le natel|noun', 'known']]);
  const found = await call<{ mine: { key: string; status: string }[] }>('search_words', { query: 'natel' });
  assert.deepEqual(found.mine.map((w) => [w.key, w.status]), [['le natel|noun', 'known']]);
  const progress = await call<{ words: number; cards: number; reviews: number; ownWordsByStatus: Record<string, number> }>('get_progress');
  assert.equal(progress.words, 1);
  assert.equal(progress.cards, 1);
  assert.deepEqual(progress.ownWordsByStatus, { known: 1 });
  /* Offering it again says so. */
  const again = await call<Added>('add_words', { words: [{ fr: 'natel', en: ['cell'] }] });
  assert.equal(again.results[0]!.candidates![0]!.status, 'known');
});

test('a word the learner set aside is listed as skipped', async () => {
  const { h, userId, call } = await connect();
  await h.env.DB.prepare(
    `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,0,1)`)
    .bind(userId, 'train|noun', JSON.stringify({ k: 'train|noun', fr: 'le train', en: ['train'], pos: 'noun',
      source: 'catalogue', skipped: true, updatedAt: 1 }), 1).run();
  const listed = await call<{ words: { key: string; status: string }[] }>('list_words');
  assert.deepEqual(listed.words.map((w) => [w.key, w.status]), [['train|noun', 'skipped']]);
});

test('search looks in all three places and says which', async () => {
  const { call } = await connect();
  await call<Added>('add_words', { words: [{ fr: 'le natel', en: ['mobile phone'], pos: 'noun' }] });
  const fr = await call<{ mine: unknown[]; catalogue: { key: string; status: string; level: number }[]; dictionary: { key: string }[] }>(
    'search_words', { query: 'tra' });
  assert.deepEqual(fr.catalogue.map((c) => [c.key, c.status, c.level]), [['train|noun', 'not scheduled', 1]]);
  const en = await call<{ mine: { key: string }[]; catalogue: { key: string }[] }>('search_words', { query: 'phone' });
  assert.deepEqual(en.mine.map((m) => m.key), ['le natel|noun']);
  const dict = await call<{ dictionary: { key: string; gender: string }[] }>('search_words', { query: 'chausse' });
  assert.deepEqual(dict.dictionary.map((d) => [d.key, d.gender]), [['la chaussette|noun', 'f']]);
});

test('a word already in the list comes back from search as mine, whatever it came from', async () => {
  /* Search once showed a promoted word as source "catalogue" and an own word
     as "app" — the record's provenance overwrote the "mine" it was meant to
     carry. Claude read that as "not in the list", called add_words, and was
     told "unchanged". Now every list word says "mine", and where it came from
     is its origin. */
  const { call } = await connect();
  await call<Added>('add_words', { words: [
    { fr: 'le train', en: ['train'] },                          /* promoted from the catalogue */
    { fr: 'le natel', en: ['mobile phone'], pos: 'noun' },     /* the learner's own */
  ] });
  interface Hit { source: string; origin: string; key: string }
  interface Found { mine: Hit[]; catalogue: { key: string }[] }
  const train = await call<Found>('search_words', { query: 'train' });
  assert.deepEqual(train.mine.map((w) => [w.source, w.origin, w.key]), [['mine', 'catalogue', 'train|noun']]);
  assert.deepEqual(train.catalogue.map((c) => c.key), [], 'a promoted word is not offered from the catalogue again');
  const natel = await call<Found>('search_words', { query: 'natel' });
  assert.deepEqual(natel.mine.map((w) => [w.source, w.origin, w.key]), [['mine', 'app', 'le natel|noun']]);
  /* The list shows the same shape. */
  const listed = await call<{ words: Hit[] }>('list_words');
  assert.deepEqual(listed.words.map((w) => [w.source, w.origin]), [['mine', 'catalogue'], ['mine', 'app']]);
});

test('a correction keeps the key; respelling onto another word is refused unless forced', async () => {
  const { h, userId, call } = await connect();
  await call<Added>('add_words', { words: [{ fr: 'natel', en: ['mobile phone'] }] });
  interface Changed { written: number; results: { key: string; action: string; changed?: string[]; candidates?: { key: string }[] }[] }
  const out = await call<Changed>('update_words', { changes: [
    { key: 'natel|unknown', fr: 'le natel', pos: 'noun', gender: 'm', en: ['mobile phone', 'cell phone'] },
    { key: 'nothing|noun', note: 'x' },
  ] });
  assert.deepEqual(out.results.map((r) => [r.key, r.action]), [['natel|unknown', 'update'], ['nothing|noun', 'missing']]);
  assert.deepEqual(out.results[0]!.changed, ['fr', 'en', 'pos', 'gender']);
  const stored = (await rows(h, userId))[0]!;
  assert.equal(stored.k, 'natel|unknown', 'the key is the identity: cards and history stay');
  assert.equal(stored.fr, 'le natel');
  assert.equal(stored.pos, 'noun');
  const clash = await call<Changed>('update_words', { changes: [{ key: 'natel|unknown', fr: 'le train' }] });
  assert.equal(clash.results[0]!.action, 'conflict');
  assert.deepEqual(clash.results[0]!.candidates!.map((c) => c.key), ['train|noun']);
  assert.equal(clash.written, 0);
  const forced = await call<Changed>('update_words', { changes: [
    { key: 'natel|unknown', fr: 'le train', resolve: { force: true } }] });
  assert.equal(forced.results[0]!.action, 'update');
});

test('an unreadable catalogue is said in the answer and the list still works', async () => {
  const { call } = await connect({ catalogue: false });
  const out = await call<Added>('add_words', { words: [{ fr: 'le train', en: ['train'] }] });
  assert.equal(out.results[0]!.action, 'add', 'cannot promote what it cannot see');
  assert.match(out.notes.join(' '), /catalogue could not be read/);
  const found = await call<{ notes: string[] }>('search_words', { query: 'train' });
  assert.match(found.notes.join(' '), /catalogue could not be read/);
});

test('a full-scope device may use the connector too; a revoked one may not', async () => {
  const h = harness();
  const { token } = await h.signIn('learner@example.com', 'full');
  const ok = await h.fetch('/mcp', { method: 'POST', token, json: { jsonrpc: '2.0', id: 1, method: 'ping' } });
  assert.equal(ok.status, 200);
  await h.env.DB.prepare('UPDATE devices SET revoked = 1').run();
  const no = await h.fetch('/mcp', { method: 'POST', token, json: { jsonrpc: '2.0', id: 1, method: 'ping' } });
  assert.equal(no.status, 401);
});

test('progress names the grammar bits the learner has started, with what each has earned', async () => {
  const { call, userId, h } = await connect();
  const now = Date.now();
  /* A device started two bits, answered a table of one right on four verbs,
     and its card has stuck; the other was started and never asked. */
  const bit = (id: string): string => JSON.stringify({ id, openedAt: now, updatedAt: now, v: 1 });
  await h.env.DB.prepare('INSERT INTO bits (user_id, id, data, updatedAt, deleted, seq) VALUES (?,?,?,?,0,1)')
    .bind(userId, 'V.pres-er', bit('V.pres-er'), now).run();
  await h.env.DB.prepare('INSERT INTO bits (user_id, id, data, updatedAt, deleted, seq) VALUES (?,?,?,?,0,2)')
    .bind(userId, 'G.pas', bit('G.pas'), now).run();
  const card = { id: 'V.pres-er|produce', rule: 'V.pres-er', mode: 'produce', state: 2, stability: 30, difficulty: 5,
    due: new Date(now + 864e5 * 20).toISOString(), elapsed_days: 0, scheduled_days: 20, learning_steps: 0, reps: 4,
    lapses: 0, v: 1 };
  await h.env.DB.prepare('INSERT INTO rulecards (user_id, id, data, updatedAt, seq) VALUES (?,?,?,?,3)')
    .bind(userId, card.id, JSON.stringify(card), now).run();
  for (const [i, v] of ['parler', 'aimer', 'chanter', 'manger'].entries()) {
    const attempt = { uid: `a${i}`, ts: Math.floor(now / 1000) - i, ms: 9000, gen: 'table', face: 'gap',
      spec: { key: `${v}|verb`, tense: 'pres' }, instance: `table:${v}|verb:pres`,
      parts: [{ expected: 'x', got: 'x', ok: true, obs: [{ of: 'V.pres-er', ok: true }] }],
      grades: { 'V.pres-er|produce': 3 }, v: 1, genv: 1 };
    await h.env.DB.prepare('INSERT INTO attempts (user_id, uid, data, ts, seq) VALUES (?,?,?,?,?)')
      .bind(userId, attempt.uid, JSON.stringify(attempt), attempt.ts, 10 + i).run();
  }
  const progress = await call<{ grammar: { started: { rule: string; name: string; breadth: number; passed: boolean }[]; attempts: number } }>('get_progress');
  assert.deepEqual(progress.grammar, {
    started: [
      { rule: 'V.pres-er', name: 'Présent', breadth: 4, passed: true },
      { rule: 'G.pas', name: 'Saying no: ne … pas', breadth: 0, passed: false },
    ],
    attempts: 4,
  });
});
