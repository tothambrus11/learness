/** Sync API.
 *
 *  One user, several devices, plus an authenticated Claude session that may
 *  touch the hand-added word list and nothing else.
 *
 *  Two scopes:
 *    full  - the study app: syncs words, cards, reviews and lessons
 *    words - a Claude session over MCP: reads and writes your own word list and
 *            lessons, and can read a progress summary. It cannot read the review
 *            log and cannot write scheduling state, so an agent can help curate
 *            vocabulary without being able to corrupt or exfiltrate your history.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function cors(env) {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-max-age': '86400',
  };
}

const reply = (env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(env) } });

const fail = (env, status, message) => reply(env, { error: message }, status);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function authenticate(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    'SELECT token_hash, name, scope FROM devices WHERE token_hash = ?').bind(hash).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE token_hash = ?')
    .bind(Date.now(), hash).run();
  return row;
}

async function nextSeq(env, count) {
  await env.DB.prepare('UPDATE counter SET value = value + ? WHERE name = ?')
    .bind(count, 'seq').run();
  const row = await env.DB.prepare('SELECT value FROM counter WHERE name = ?')
    .bind('seq').first();
  return row.value - count;   // first seq of the block we just reserved
}

/* ------------------------------------------------------------------ sync -- */

async function handleSync(request, env) {
  const body = await request.json();
  const since = Number(body.since || 0);
  const push = body.push || {};

  const counts = { words: 0, cards: 0, reviews: 0, lessons: 0 };
  const writes = [];
  let seq = await nextSeq(env,
    (push.words?.length || 0) + (push.cards?.length || 0) +
    (push.reviews?.length || 0) + (push.lessons?.length || 0));

  for (const w of push.words || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO words (k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,?)
       ON CONFLICT(k) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt,
         deleted=excluded.deleted, seq=excluded.seq
       WHERE excluded.updatedAt > words.updatedAt`)
      .bind(w.k, JSON.stringify(w), w.updatedAt || 0, w.deleted ? 1 : 0, seq++));
    counts.words++;
  }
  for (const c of push.cards || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO cards (id, data, updatedAt, seq) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt,
         seq=excluded.seq
       WHERE excluded.updatedAt > cards.updatedAt`)
      .bind(c.id, JSON.stringify(c), c.updatedAt || 0, seq++));
    counts.cards++;
  }
  for (const r of push.reviews || []) {
    /* Append-only: an id that already exists is simply ignored, which makes a
       repeated push harmless. */
    writes.push(env.DB.prepare(
      'INSERT OR IGNORE INTO reviews (uid, data, ts, seq) VALUES (?,?,?,?)')
      .bind(r.uid, JSON.stringify(r), r.ts || 0, seq++));
    counts.reviews++;
  }
  for (const l of push.lessons || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO lessons (id, data, updatedAt, seq) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt,
         seq=excluded.seq
       WHERE excluded.updatedAt > lessons.updatedAt`)
      .bind(String(l.id), JSON.stringify(l), l.updatedAt || 0, seq++));
    counts.lessons++;
  }
  if (writes.length) await env.DB.batch(writes);

  const pull = {};
  for (const [table, key] of [['words', 'k'], ['cards', 'id'], ['reviews', 'uid'],
    ['lessons', 'id']]) {
    const rows = await env.DB.prepare(
      `SELECT data FROM ${table} WHERE seq > ? ORDER BY seq LIMIT 5000`).bind(since).all();
    pull[table] = rows.results.map((r) => JSON.parse(r.data));
  }
  const cursor = (await env.DB.prepare('SELECT value FROM counter WHERE name = ?')
    .bind('seq').first()).value;

  return reply(env, { cursor, pushed: counts, pull });
}

/* ------------------------------------------------------------- word list -- */

async function listWords(env, url) {
  const includeDeleted = url.searchParams.get('deleted') === '1';
  const sql = includeDeleted
    ? 'SELECT data FROM words ORDER BY seq'
    : 'SELECT data FROM words WHERE deleted = 0 ORDER BY seq';
  const rows = await env.DB.prepare(sql).all();
  return reply(env, { words: rows.results.map((r) => JSON.parse(r.data)) });
}

async function putWords(env, body) {
  const incoming = Array.isArray(body) ? body : body.words || [];
  if (!incoming.length) return reply(env, { written: 0 });
  let seq = await nextSeq(env, incoming.length);
  const now = Date.now();
  const writes = incoming.map((w) => {
    const record = { ...w, updatedAt: w.updatedAt || now };
    return env.DB.prepare(
      `INSERT INTO words (k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,?)
       ON CONFLICT(k) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt,
         deleted=excluded.deleted, seq=excluded.seq
       WHERE excluded.updatedAt > words.updatedAt`)
      .bind(record.k, JSON.stringify(record), record.updatedAt, record.deleted ? 1 : 0, seq++);
  });
  await env.DB.batch(writes);
  return reply(env, { written: writes.length });
}

async function deleteWord(env, key) {
  const seq = await nextSeq(env, 1);
  const now = Date.now();
  const record = { k: key, deleted: true, updatedAt: now };
  await env.DB.prepare(
    `INSERT INTO words (k, data, updatedAt, deleted, seq) VALUES (?,?,?,1,?)
     ON CONFLICT(k) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt,
       deleted=1, seq=excluded.seq`)
    .bind(key, JSON.stringify(record), now, seq).run();
  return reply(env, { deleted: key });
}

async function progressSummary(env) {
  /* Counts only. A words-scoped caller never sees the review log itself. */
  const one = async (sql) => (await env.DB.prepare(sql).first())?.n ?? 0;
  return reply(env, {
    words: await one('SELECT COUNT(*) n FROM words WHERE deleted = 0'),
    cards: await one('SELECT COUNT(*) n FROM cards'),
    reviews: await one('SELECT COUNT(*) n FROM reviews'),
    lessons: await one('SELECT COUNT(*) n FROM lessons'),
  });
}

/** Static assets, with a single-page-app fallback done here rather than by the
 *  asset router, so that /v1/* still reaches this Worker. */
async function serveAsset(request, env) {
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 404) return res;
  const url = new URL(request.url);
  url.pathname = '/index.html';
  const fallback = await env.ASSETS.fetch(new Request(url, request));
  return new Response(fallback.body, {
    status: fallback.status,
    headers: { ...Object.fromEntries(fallback.headers), 'content-type': 'text/html; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* Anything that is not the API is the app. */
    if (!url.pathname.startsWith('/v1/')) return serveAsset(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }
    if (url.pathname === '/v1/health') return reply(env, { ok: true });

    const device = await authenticate(request, env);
    if (!device) return fail(env, 401, 'authenticate with a device token');
    const full = device.scope === 'full';

    try {
      if (url.pathname === '/v1/sync' && request.method === 'POST') {
        if (!full) return fail(env, 403, 'this token may only use the word list');
        return await handleSync(request, env);
      }
      if (url.pathname === '/v1/words') {
        if (request.method === 'GET') return await listWords(env, url);
        if (request.method === 'POST') return await putWords(env, await request.json());
      }
      if (url.pathname.startsWith('/v1/words/') && request.method === 'DELETE') {
        return await deleteWord(env, decodeURIComponent(url.pathname.slice('/v1/words/'.length)));
      }
      if (url.pathname === '/v1/progress' && request.method === 'GET') {
        return await progressSummary(env);
      }
    } catch (err) {
      return fail(env, 500, String(err?.message || err));
    }
    return fail(env, 404, 'no such endpoint');
  },
};
