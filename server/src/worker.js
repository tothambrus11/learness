/** The app and its sync API, on one origin.
 *
 *    /            the study app (static assets)
 *    /v1/auth/*   logging in, guarded by Cloudflare Access
 *    /v1/*        everything else, guarded by a per-device bearer token
 *
 *  Identity is Cloudflare Access's job: it runs the email one-time code (or
 *  Google or GitHub) and hands us a signed assertion. This Worker verifies that
 *  signature, maps the verified email to an account, and issues a long-lived
 *  device token. Every subsequent request carries that token instead of a
 *  cookie, which keeps the phone's offline sync free of login redirects.
 *
 *  Every row belongs to exactly one account, and every query is scoped to the
 *  account on the presented token. There is no path that reads across accounts.
 */
import { accountId, tokenFromRequest, verifyAccessToken } from './access.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const cors = (env) => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-max-age': '86400',
});

const reply = (env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(env) } });
const fail = (env, status, message) => reply(env, { error: message }, status);

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------ device auth -- */

async function authenticate(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT d.token_hash, d.user_id, d.name, d.scope, u.email
       FROM devices d JOIN users u ON u.id = d.user_id
      WHERE d.token_hash = ? AND d.revoked = 0`).bind(hash).first();
  if (!row) return null;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE devices SET last_seen = ? WHERE token_hash = ?').bind(now, hash),
    env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, row.user_id),
  ]);
  return row;
}

/** Sequence numbers are per account, so one person's writes never advance
 *  another's pull cursor. */
async function nextSeq(env, userId, count) {
  await env.DB.prepare(
    `INSERT INTO counter (user_id, value) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET value = value + ?`)
    .bind(userId, count, count).run();
  const row = await env.DB.prepare('SELECT value FROM counter WHERE user_id = ?')
    .bind(userId).first();
  return row.value - count;
}

const currentSeq = async (env, userId) =>
  (await env.DB.prepare('SELECT value FROM counter WHERE user_id = ?').bind(userId).first())
    ?.value ?? 0;

/* ----------------------------------------------------------------- login -- */

async function ensureAccount(env, email) {
  const id = await accountId(email);
  await env.DB.prepare(
    `INSERT INTO users (id, email, created, last_seen) VALUES (?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`)
    .bind(id, String(email).trim().toLowerCase(), Date.now(), Date.now()).run();
  return id;
}

async function issueToken(env, userId, name, scope) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    'INSERT INTO devices (token_hash, user_id, name, scope, created) VALUES (?,?,?,?,?)')
    .bind(hash, userId, name.slice(0, 60), scope, Date.now()).run();
  return { token, hash };
}

/** The identity Access verified for this request, or null. */
async function accessIdentity(request, env) {
  const payload = await verifyAccessToken(tokenFromRequest(request), env);
  if (!payload) return null;
  return { email: payload.email || payload.common_name, payload };
}

/** Only ever redirect back into this same app. An open redirect here would let
 *  another site collect a freshly minted token. */
function safeRedirect(target, request) {
  if (!target) return null;
  try {
    const url = new URL(target, request.url);
    if (url.origin !== new URL(request.url).origin) return null;
    return url;
  } catch {
    return null;
  }
}

async function handleAuth(request, env, url) {
  const path = url.pathname.slice('/v1/auth'.length) || '/';

  /* Everything under /v1/auth needs a verified Access identity. */
  if (path === '/session' || path === '/device' || path === '/start') {
    const identity = await accessIdentity(request, env);
    if (!identity) {
      return fail(env, 401,
        env.ACCESS_TEAM_DOMAIN
          ? 'no valid Cloudflare Access session for this request'
          : 'Cloudflare Access is not configured on this deployment');
    }

    if (path === '/session') {
      const userId = await ensureAccount(env, identity.email);
      return reply(env, { email: identity.email, account: userId });
    }

    if (path === '/device' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const scope = body.scope === 'words' ? 'words' : 'full';
      const userId = await ensureAccount(env, identity.email);
      const { token } = await issueToken(env, userId, body.name || 'device', scope);
      return reply(env, { token, scope, email: identity.email });
    }

    /* Browser login: land here from the app, come back with a token in the
       fragment. Fragments are not sent to servers and do not appear in logs. */
    if (path === '/start') {
      const userId = await ensureAccount(env, identity.email);
      const scope = url.searchParams.get('scope') === 'words' ? 'words' : 'full';
      const name = url.searchParams.get('name') || 'browser';
      const { token } = await issueToken(env, userId, name, scope);
      const back = safeRedirect(url.searchParams.get('redirect') || '/', request);
      if (!back) return reply(env, { token, scope, email: identity.email });
      back.hash = `token=${encodeURIComponent(token)}`;
      return Response.redirect(back.toString(), 302);
    }
  }

  /* Managing devices uses the token you already have, not an Access session,
     so you can revoke a lost phone from the app. */
  if (path === '/devices') {
    const device = await authenticate(request, env);
    if (!device) return fail(env, 401, 'authenticate with a device token');
    if (request.method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT token_hash, name, scope, created, last_seen, revoked
           FROM devices WHERE user_id = ? ORDER BY created`).bind(device.user_id).all();
      return reply(env, {
        email: device.email,
        devices: rows.results.map((d) => ({
          id: d.token_hash.slice(0, 12), name: d.name, scope: d.scope,
          created: d.created, lastSeen: d.last_seen, revoked: !!d.revoked,
          current: d.token_hash === device.token_hash,
        })),
      });
    }
  }
  if (path.startsWith('/devices/') && request.method === 'DELETE') {
    const device = await authenticate(request, env);
    if (!device) return fail(env, 401, 'authenticate with a device token');
    const id = decodeURIComponent(path.slice('/devices/'.length));
    const res = await env.DB.prepare(
      `UPDATE devices SET revoked = 1
        WHERE user_id = ? AND substr(token_hash, 1, 12) = ?`).bind(device.user_id, id).run();
    return reply(env, { revoked: res.meta.changes });
  }
  return fail(env, 404, 'no such endpoint');
}

/* ------------------------------------------------------------------ sync -- */

async function handleSync(request, env, user) {
  const body = await request.json();
  const since = Number(body.since || 0);
  const push = body.push || {};
  const counts = { words: 0, cards: 0, reviews: 0, lessons: 0 };
  const writes = [];

  const total = (push.words?.length || 0) + (push.cards?.length || 0)
    + (push.reviews?.length || 0) + (push.lessons?.length || 0);
  let seq = total ? await nextSeq(env, user, total) : await currentSeq(env, user);

  for (const w of push.words || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, k) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, deleted=excluded.deleted, seq=excluded.seq
       WHERE excluded.updatedAt > words.updatedAt`)
      .bind(user, w.k, JSON.stringify(w), w.updatedAt || 0, w.deleted ? 1 : 0, seq++));
    counts.words++;
  }
  for (const c of push.cards || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO cards (user_id, id, data, updatedAt, seq) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, id) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, seq=excluded.seq
       WHERE excluded.updatedAt > cards.updatedAt`)
      .bind(user, c.id, JSON.stringify(c), c.updatedAt || 0, seq++));
    counts.cards++;
  }
  for (const r of push.reviews || []) {
    writes.push(env.DB.prepare(
      'INSERT OR IGNORE INTO reviews (user_id, uid, data, ts, seq) VALUES (?,?,?,?,?)')
      .bind(user, r.uid, JSON.stringify(r), r.ts || 0, seq++));
    counts.reviews++;
  }
  for (const l of push.lessons || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO lessons (user_id, id, data, updatedAt, seq) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, id) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, seq=excluded.seq
       WHERE excluded.updatedAt > lessons.updatedAt`)
      .bind(user, String(l.id), JSON.stringify(l), l.updatedAt || 0, seq++));
    counts.lessons++;
  }
  if (writes.length) await env.DB.batch(writes);

  const pull = {};
  for (const table of ['words', 'cards', 'reviews', 'lessons']) {
    const rows = await env.DB.prepare(
      `SELECT data FROM ${table} WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 5000`)
      .bind(user, since).all();
    pull[table] = rows.results.map((r) => JSON.parse(r.data));
  }
  return reply(env, { cursor: await currentSeq(env, user), pushed: counts, pull });
}

/* ------------------------------------------------------------- word list -- */

async function listWords(env, user, url) {
  const includeDeleted = url.searchParams.get('deleted') === '1';
  const rows = await env.DB.prepare(
    `SELECT data FROM words WHERE user_id = ?${includeDeleted ? '' : ' AND deleted = 0'}
     ORDER BY seq`).bind(user).all();
  return reply(env, { words: rows.results.map((r) => JSON.parse(r.data)) });
}

async function putWords(env, user, body) {
  const incoming = Array.isArray(body) ? body : body.words || [];
  if (!incoming.length) return reply(env, { written: 0 });
  let seq = await nextSeq(env, user, incoming.length);
  const now = Date.now();
  await env.DB.batch(incoming.map((w) => {
    const record = { ...w, updatedAt: w.updatedAt || now };
    return env.DB.prepare(
      `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, k) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, deleted=excluded.deleted, seq=excluded.seq
       WHERE excluded.updatedAt > words.updatedAt`)
      .bind(user, record.k, JSON.stringify(record), record.updatedAt,
        record.deleted ? 1 : 0, seq++);
  }));
  return reply(env, { written: incoming.length });
}

async function deleteWord(env, user, key) {
  const seq = await nextSeq(env, user, 1);
  const now = Date.now();
  const record = { k: key, deleted: true, updatedAt: now };
  await env.DB.prepare(
    `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,1,?)
     ON CONFLICT(user_id, k) DO UPDATE SET data=excluded.data,
       updatedAt=excluded.updatedAt, deleted=1, seq=excluded.seq`)
    .bind(user, key, JSON.stringify(record), now, seq).run();
  return reply(env, { deleted: key });
}

async function progressSummary(env, user) {
  const count = async (table) => (await env.DB.prepare(
    `SELECT COUNT(*) n FROM ${table} WHERE user_id = ?`).bind(user).first())?.n ?? 0;
  return reply(env, {
    words: (await env.DB.prepare(
      'SELECT COUNT(*) n FROM words WHERE user_id = ? AND deleted = 0').bind(user).first())?.n ?? 0,
    cards: await count('cards'),
    reviews: await count('reviews'),
    lessons: await count('lessons'),
  });
}

/* ---------------------------------------------------------------- assets -- */

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
    if (!url.pathname.startsWith('/v1/')) return serveAsset(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }
    if (url.pathname === '/v1/health') return reply(env, { ok: true });

    try {
      if (url.pathname.startsWith('/v1/auth')) return await handleAuth(request, env, url);

      const device = await authenticate(request, env);
      if (!device) return fail(env, 401, 'authenticate with a device token');
      const user = device.user_id;
      const full = device.scope === 'full';

      if (url.pathname === '/v1/sync' && request.method === 'POST') {
        if (!full) return fail(env, 403, 'this token may only use the word list');
        return await handleSync(request, env, user);
      }
      if (url.pathname === '/v1/words') {
        if (request.method === 'GET') return await listWords(env, user, url);
        if (request.method === 'POST') return await putWords(env, user, await request.json());
      }
      if (url.pathname.startsWith('/v1/words/') && request.method === 'DELETE') {
        return await deleteWord(env, user,
          decodeURIComponent(url.pathname.slice('/v1/words/'.length)));
      }
      if (url.pathname === '/v1/progress' && request.method === 'GET') {
        return await progressSummary(env, user);
      }
    } catch (err) {
      return fail(env, 500, String(err?.message || err));
    }
    return fail(env, 404, 'no such endpoint');
  },
};
