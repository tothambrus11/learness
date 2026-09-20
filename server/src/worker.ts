/** The app, its sync API and its MCP connector, on one origin.
 *
 *    /              the study app (static assets)
 *    /v1/auth/*     logging in
 *    /v1/oauth/*    letting an MCP client in (oauth.ts)
 *    /.well-known/  where a client finds out how
 *    /mcp           the connector itself, guarded by a device token (mcp/)
 *    /v1/*          everything else, guarded by a per-device bearer token
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
import { tokenFromRequest, verifyAccessToken } from './access.js';
import { isPagePath, isolated } from './assets.js';
import { catalogueOf } from './catalogue.js';
import { sendLoginCode } from './email.js';
import { SERVER_INFO, TOOLS } from './mcp/tools.js';
import { nowMs, serveMcp } from './mcp/protocol.js';
import { handleOAuth, OPEN_CORS, unauthorised, wellKnown } from './oauth.js';
import {
  CODE_TTL_MS, checkCode, generateCode, hashCode, looksLikeEmail, normaliseEmail, rateLimit,
} from './otp.js';
import {
  loginOptions, registrationOptions, verifyLogin, verifyRegistration,
} from './passkeys.js';
import type { LoginBody, RegisterBody } from './passkeys.js';
import type { Env, Push, SyncBody, WireWord } from './env.js';
import { authenticate, ensureAccount, issueToken } from './tokens.js';
import { currentSeq, d1WordStore, seqRun, trustUserWord } from './wordstore.js';

/** A JSON body, as it arrives: whatever was sent, if anything. Everything the
 *  Worker reads out of one goes through `field`, which is where a request
 *  stops being arbitrary JSON and becomes a string this code can use. */
type Body = Record<string, unknown>;
/** One field of a request body as a string. Anything that is not a string —
 *  a number, an object, nothing at all — is not the thing that was asked for,
 *  and an empty string is refused by every caller. */
const field = (body: Body, name: string): string => {
  const value = body[name];
  return typeof value === 'string' ? value : '';
};
const asBody = async (request: Request): Promise<Body> =>
  request.json<Body>().catch(() => ({}));

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const cors = (env: Env): Record<string, string> => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-max-age': '86400',
});

const reply = (env: Env, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(env) } });
const fail = (env: Env, status: number, message: string): Response =>
  reply(env, { error: message }, status);

/* ----------------------------------------------------------------- login -- */

/** The identity Access verified for this request, or null. */
async function accessIdentity(request: Request, env: Env): Promise<{ email: string } | null> {
  const payload = await verifyAccessToken(tokenFromRequest(request), env);
  const email = payload?.email ?? payload?.common_name;
  return email ? { email } : null;
}

/** Only ever redirect back into this same app. An open redirect here would let
 *  another site collect a freshly minted token. */
function safeRedirect(target: string | null, request: Request): URL | null {
  if (!target) return null;
  try {
    const url = new URL(target, request.url);
    if (url.origin !== new URL(request.url).origin) return null;
    return url;
  } catch {
    return null;
  }
}

/* --- email one-time code -------------------------------------------------
 *
 * The login this deployment actually uses. Cloudflare Access is free only to
 * 50 seats; this costs nothing per user. It stays cheap because a device token
 * is long-lived, so a code is needed when adding a device, not on every visit.
 */

async function requestCode(request: Request, env: Env): Promise<Response> {
  const body = await asBody(request);
  const email = normaliseEmail(body.email);
  if (!looksLikeEmail(email)) return fail(env, 400, 'that does not look like an email address');

  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT email, requests, window_start FROM login_codes WHERE email = ?')
    .bind(email).first<{ requests: number; window_start: number }>();
  const limit = rateLimit(row, now);
  if (!limit.allowed) {
    return reply(env, { error: `too many requests; try again in ${limit.retryIn}s` }, 429);
  }

  const code = generateCode();
  const codeHash = await hashCode(email, code, env.CODE_PEPPER ?? '');
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, expires, attempts, sent, requests, window_start)
     VALUES (?,?,?,0,?,?,?)
     ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires=excluded.expires,
       attempts=0, sent=excluded.sent, requests=excluded.requests,
       window_start=excluded.window_start`)
    .bind(email, codeHash, now + CODE_TTL_MS, now, limit.requests, limit.windowStart).run();

  try {
    await sendLoginCode(env, email, code);
  } catch (err) {
    return fail(env, 503, (err as Error).message);
  }
  /* Always the same answer, so this cannot be used to discover who has an
     account. Accounts are created on first successful login anyway. */
  return reply(env, { sent: true, expiresIn: CODE_TTL_MS / 1000 });
}

async function verifyCode(request: Request, env: Env): Promise<Response> {
  const body = await asBody(request);
  const email = normaliseEmail(body.email);
  const code = field(body, 'code').trim();
  if (!looksLikeEmail(email) || !code) return fail(env, 400, 'email and code are both required');

  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT email, code_hash, expires, attempts FROM login_codes WHERE email = ?')
    .bind(email).first<{ code_hash: string; expires: number; attempts: number }>();
  const supplied = await hashCode(email, code, env.CODE_PEPPER ?? '');
  const verdict = checkCode(row, supplied, now);

  if (verdict.countAttempt) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?')
      .bind(email).run();
  }
  if (verdict.destroy) {
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
  }
  if (!verdict.ok) return fail(env, 401, verdict.reason ?? 'that code was not accepted');

  const userId = await ensureAccount(env, email);
  const scope = body.scope === 'words' ? 'words' : 'full';
  const { token } = await issueToken(env, userId, field(body, 'name') || 'device', scope);
  return reply(env, { token, scope, email });
}

async function handleAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.slice('/v1/auth'.length) || '/';

  if (path === '/request' && request.method === 'POST') return requestCode(request, env);
  if (path === '/verify' && request.method === 'POST') return verifyCode(request, env);

  /* --- passkeys ---
   *
   * Signing in is public, by necessity. Registering is not: it requires a token
   * you already hold, because otherwise anyone could attach their own passkey
   * to someone else's account. */
  if (path === '/passkey/login/options' && request.method === 'POST') {
    const { challengeId, options } = await loginOptions(env, request);
    return reply(env, { challengeId, options });
  }
  if (path === '/passkey/login/verify' && request.method === 'POST') {
    const body = (await asBody(request)) as unknown as LoginBody & Body;
    const result = await verifyLogin(env, request, body);
    if (!result.ok) return fail(env, 401, result.error);
    const { token } = await issueToken(
      env, result.userId, field(body, 'name') || 'passkey device',
      body.scope === 'words' ? 'words' : 'full');
    return reply(env, { token, email: result.email });
  }
  if (path.startsWith('/passkey/register')) {
    const device = await authenticate(request, env);
    if (!device) {
      return fail(env, 401, 'sign in first: a passkey can only be added to an account you hold');
    }
    if (path === '/passkey/register/options' && request.method === 'POST') {
      const { challengeId, options } = await registrationOptions(env, request, device);
      return reply(env, { challengeId, options });
    }
    if (path === '/passkey/register/verify' && request.method === 'POST') {
      const result = await verifyRegistration(
        env, request, device, (await asBody(request)) as unknown as RegisterBody);
      if (!result.ok) return fail(env, 400, result.error);
      return reply(env, result);
    }
  }
  if (path === '/passkeys' && request.method === 'GET') {
    const device = await authenticate(request, env);
    if (!device) return fail(env, 401, 'authenticate with a device token');
    const rows = await env.DB.prepare(
      `SELECT cred_id, name, device_type, backed_up, created, last_used
         FROM passkeys WHERE user_id = ? ORDER BY created`).bind(device.user_id).all();
    return reply(env, {
      passkeys: rows.results.map((k) => ({
        id: k.cred_id, name: k.name, created: k.created, lastUsed: k.last_used,
        /* A backed-up passkey syncs through iCloud or Google; one that is not
           lives on a single device and is gone if that device is. */
        syncs: !!k.backed_up, deviceType: k.device_type,
      })),
    });
  }
  if (path.startsWith('/passkeys/') && request.method === 'DELETE') {
    const device = await authenticate(request, env);
    if (!device) return fail(env, 401, 'authenticate with a device token');
    const id = decodeURIComponent(path.slice('/passkeys/'.length));
    const res = await env.DB.prepare('DELETE FROM passkeys WHERE user_id = ? AND cred_id = ?')
      .bind(device.user_id, id).run();
    return reply(env, { removed: res.meta.changes });
  }

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
      const body = await asBody(request);
      const scope = body.scope === 'words' ? 'words' : 'full';
      const userId = await ensureAccount(env, identity.email);
      const { token } = await issueToken(env, userId, field(body, 'name') || 'device', scope);
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
           FROM devices WHERE user_id = ? ORDER BY created`).bind(device.user_id).all<{
             token_hash: string; name: string; scope: string;
             created: number; last_seen: number | null; revoked: number;
           }>();
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

/** How many rows of one table a sync reply carries at most.
 *
 *  A phone signing in against a long history is not handed the whole review
 *  log in one response: it gets this many rows per table, `more: true`, and
 *  a `cursor` to carry on from, which it does at once, in the same sync. The
 *  cap once came with no `more` and a cursor that was the counter whatever
 *  had been sent: a fresh device on twelve thousand reviews received the
 *  first five thousand, believed itself up to date, and never asked for the
 *  rest. Nothing failed; the history was simply shorter on that device. */
export const PULL_PAGE = 5000;

async function handleSync(request: Request, env: Env, user: string): Promise<Response> {
  const body = await request.json<SyncBody>();
  const since = body.since ?? 0;
  const push: Push = body.push ?? {};
  const counts = { words: 0, cards: 0, reviews: 0, lessons: 0, themes: 0 };

  /* The rows go in one batch with the reservation of their numbers, which
     is one transaction: another request reading the counter sees these rows
     or a counter below them, never a number with no row behind it yet. */
  const total = (push.words?.length ?? 0) + (push.cards?.length ?? 0)
    + (push.reviews?.length ?? 0) + (push.lessons?.length ?? 0) + (push.themes?.length ?? 0);
  const run = seqRun(env, user, total);
  const writes: D1PreparedStatement[] = [run.reserve];
  let i = 0;

  for (const w of push.words || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,?,${run.at})
       ON CONFLICT(user_id, k) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, deleted=excluded.deleted, seq=excluded.seq
       WHERE excluded.updatedAt > words.updatedAt`)
      .bind(user, w.k, JSON.stringify(w), w.updatedAt || 0, w.deleted ? 1 : 0, ...run.binds(i++)));
    counts.words++;
  }
  for (const c of push.cards || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO cards (user_id, id, data, updatedAt, seq) VALUES (?,?,?,?,${run.at})
       ON CONFLICT(user_id, id) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, seq=excluded.seq
       WHERE excluded.updatedAt > cards.updatedAt`)
      .bind(user, c.id, JSON.stringify(c), c.updatedAt || 0, ...run.binds(i++)));
    counts.cards++;
  }
  for (const r of push.reviews || []) {
    writes.push(env.DB.prepare(
      `INSERT OR IGNORE INTO reviews (user_id, uid, data, ts, seq) VALUES (?,?,?,?,${run.at})`)
      .bind(user, r.uid, JSON.stringify(r), r.ts || 0, ...run.binds(i++)));
    counts.reviews++;
  }
  for (const l of push.lessons || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO lessons (user_id, id, data, updatedAt, seq) VALUES (?,?,?,?,${run.at})
       ON CONFLICT(user_id, id) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, seq=excluded.seq
       WHERE excluded.updatedAt > lessons.updatedAt`)
      .bind(user, l.id, JSON.stringify(l), l.updatedAt ?? 0, ...run.binds(i++)));
    counts.lessons++;
  }
  /* A theme is the learner's own work, like a word: the later edit wins and
     a deletion is a tombstone that travels, so the device that missed it
     does not bring the theme back (#66). */
  for (const t of push.themes || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO themes (user_id, id, data, updatedAt, deleted, seq) VALUES (?,?,?,?,?,${run.at})
       ON CONFLICT(user_id, id) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, deleted=excluded.deleted, seq=excluded.seq
       WHERE excluded.updatedAt > themes.updatedAt`)
      .bind(user, t.id, JSON.stringify(t), t.updatedAt || 0, t.deleted ? 1 : 0, ...run.binds(i++)));
    counts.themes++;
  }
  if (total) await env.DB.batch(writes);

  /* The counter is read before the rows are, not after: a row another
     request commits while this reply is being put together is then either
     in the reply or past the cursor, and comes down next time. Read after,
     it could stand past a row the reply had already looked for. */
  const counter = await currentSeq(env, user);

  /* The cursor a device holds is the counter as it stood when it last looked:
     the first number not yet handed out, not the last one it saw. Rows are
     numbered from zero, so what is new to the device is everything at or
     past its cursor. This asked for `seq > ?` once, and the row written at
     exactly the cursor was never pulled: a word added on its own on the
     phone never reached the laptop, and the first record of every account
     was invisible to a fresh device.

     A reply carries at most `PULL_PAGE` rows of each table, in `seq` order.
     When a table's page is full there may be more, and the cursor handed
     back is then not the counter but the place to carry on from: the lowest
     `seq` this reply sent as the last of a full page. Every row past it in
     any table is either in this reply or in the next, and the one at it is
     sent twice, which `>=` already makes harmless. */
  const pull: Push = {};
  let resume: number | null = null;
  for (const table of ['words', 'cards', 'reviews', 'lessons', 'themes'] as const) {
    const rows = await env.DB.prepare(
      `SELECT data, seq FROM ${table} WHERE user_id = ? AND seq >= ? ORDER BY seq LIMIT ?`)
      .bind(user, since, PULL_PAGE).all<{ data: string; seq: number }>();
    /* Each record is stored whole and comes back as it went in; the server
       has no opinion about what is inside one. */
    pull[table] = rows.results.map((r) => JSON.parse(r.data) as never);
    const last = rows.results.at(-1);
    if (last && rows.results.length === PULL_PAGE) {
      resume = resume === null ? last.seq : Math.min(resume, last.seq);
    }
  }
  const more = resume !== null;
  return reply(env, { cursor: more ? resume : counter, more, pushed: counts, pull });
}

/* ------------------------------------------------------------- word list -- */

/* The plain REST face of the word list, kept for scripts. The connector
   itself speaks MCP at /mcp and uses the same store. */

async function listWords(env: Env, user: string, url: URL): Promise<Response> {
  const includeDeleted = url.searchParams.get('deleted') === '1';
  return reply(env, { words: await d1WordStore(env, user).words({ includeDeleted }) });
}

async function putWords(
  env: Env, user: string, body: WireWord[] | { words?: WireWord[] },
): Promise<Response> {
  const incoming = Array.isArray(body) ? body : body.words ?? [];
  const written = await d1WordStore(env, user).put(incoming.map(trustUserWord));
  return reply(env, { written });
}

async function deleteWord(env: Env, user: string, key: string): Promise<Response> {
  const now = Date.now();
  const record = { k: key, deleted: true, updatedAt: now };
  const run = seqRun(env, user, 1);
  await env.DB.batch([run.reserve, env.DB.prepare(
    `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,1,${run.at})
     ON CONFLICT(user_id, k) DO UPDATE SET data=excluded.data,
       updatedAt=excluded.updatedAt, deleted=1, seq=excluded.seq`)
    .bind(user, key, JSON.stringify(record), now, ...run.binds(0))]);
  return reply(env, { deleted: key });
}

async function progressSummary(env: Env, user: string): Promise<Response> {
  return reply(env, await d1WordStore(env, user).counts());
}

/* ------------------------------------------------------------------- mcp -- */

/** The connector. A request without a usable token is told where to get
 *  one, in the header the MCP client reads to start the OAuth flow. A token
 *  of either scope will do: `words` is what the flow issues, and a learner's
 *  own device may point Claude Code at the same endpoint. */
async function handleMcp(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: OPEN_CORS });
  const device = await authenticate(request, env);
  if (!device) return unauthorised(url.origin, 'a device token is required; connect through OAuth');
  const ctx = {
    store: d1WordStore(env, device.user_id),
    catalogue: catalogueOf(env.ASSETS, url.origin),
    now: nowMs,
  };
  return serveMcp(request, TOOLS, SERVER_INFO, ctx, OPEN_CORS);
}

/* ---------------------------------------------------------------- assets -- */

async function serveAsset(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 404) return isolated(res);
  const url = new URL(request.url);
  /* A page that is not in the store is a route the app knows and the server
     does not. A *file* that is not in the store is missing, and says so: it
     used to be answered with index.html, which is how a missing recording
     reached the browser as HTML it could not decode. */
  if (!isPagePath(url.pathname)) return new Response('Not found', { status: 404 });
  url.pathname = '/index.html';
  const fallback = await env.ASSETS.fetch(new Request(url, request));
  return isolated(new Response(fallback.body, {
    status: fallback.status,
    headers: { ...Object.fromEntries(fallback.headers), 'content-type': 'text/html; charset=utf-8' },
  }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const known = wellKnown(url);
    if (known) return known;
    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      try {
        return await handleMcp(request, env, url);
      } catch (err) {
        return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }),
          { status: 500, headers: { 'content-type': 'application/json; charset=utf-8', ...OPEN_CORS } });
      }
    }
    if (!url.pathname.startsWith('/v1/')) return serveAsset(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }
    if (url.pathname === '/v1/health') return reply(env, { ok: true });

    try {
      if (url.pathname.startsWith('/v1/auth')) return await handleAuth(request, env, url);
      if (url.pathname.startsWith('/v1/oauth')) return await handleOAuth(request, env, url);

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
        if (request.method === 'POST') {
          return await putWords(env, user, await request.json<WireWord[] | { words?: WireWord[] }>());
        }
      }
      if (url.pathname.startsWith('/v1/words/') && request.method === 'DELETE') {
        return await deleteWord(env, user,
          decodeURIComponent(url.pathname.slice('/v1/words/'.length)));
      }
      if (url.pathname === '/v1/progress' && request.method === 'GET') {
        return await progressSummary(env, user);
      }
    } catch (err) {
      return fail(env, 500, String((err as Error)?.message || err));
    }
    return fail(env, 404, 'no such endpoint');
  },
};
