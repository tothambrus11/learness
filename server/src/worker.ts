/** The app and its sync API, on one origin.
 *
 *    /            the study app (static assets)
 *    /v1/auth/*   logging in, guarded by Cloudflare Access
 *    /v1/*        everything else, guarded by a per-device bearer token
 *
 *  Every row belongs to exactly one account, and every query is scoped to the
 *  account on the presented token. There is no path that reads across accounts.
 */

/* Identity is Cloudflare Access's job: it runs the email one-time code (or
   Google or GitHub) and hands us a signed assertion. This Worker verifies that
   signature, maps the verified email to an account, and issues a long-lived
   device token. Every subsequent request carries that token instead of a
   cookie, which keeps the phone's offline sync free of login redirects. */
import type { AccessPayload } from './access';
import { accountId, tokenFromRequest, verifyAccessToken } from './access';
import { sendLoginCode } from './email';
import type { Env } from './env';
import type { CodeRow, RateLimitRow } from './otp';
import {
  CODE_TTL_MS,
  checkCode,
  generateCode,
  hashCode,
  looksLikeEmail,
  normaliseEmail,
  rateLimit,
} from './otp';
import {
  loginOptions,
  loginVerifyBody,
  registerVerifyBody,
  registrationOptions,
  verifyLogin,
  verifyRegistration,
} from './passkeys';
import type {
  DeviceBody,
  RequestCodeBody,
  SyncPullWire,
  SyncRequestBody,
  SyncTable,
  VerifyCodeBody,
  WireUserWord,
} from './protocol';
import {
  SYNC_TABLES,
  bodyString,
  deviceName,
  incomingWords,
  isJsonRecord,
  readJsonObject,
  storedRecord,
  syncPush,
} from './protocol';

/** The content type every API answer carries. */
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** Rows of one table handed to a device per sync round. */
const PAGE = 5000;

/* Same-origin is the deployed arrangement, so these matter only to a local
   `wrangler dev` on another port — which is why an unset `ALLOWED_ORIGIN` falls
   back to `*` rather than refusing. */
/** The CORS headers every API answer carries. An unset `ALLOWED_ORIGIN` allows
 *  every origin. */
const cors = (env: Env): Record<string, string> => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-max-age': '86400',
});

/** A JSON answer with the CORS headers already on it. The body is serialised
 *  as given; nothing here inspects it. */
const reply = (env: Env, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors(env) } });

/* The client never has to guess which of two shapes it got. */
/** An error answer, in the one shape the app knows how to read: `{ error }` and
 *  a status. Every refusal in this file goes through here. */
const fail = (env: Env, status: number, message: string): Response =>
  reply(env, { error: message }, status);

/** SHA-256 of the text, lower-case hex. */
async function sha256Hex(text: string): Promise<string> {
  /* Used for the token hash and nothing else: a stolen database of these does
     not hand anyone a working token. */
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------ device auth -- */

/** The device row a bearer token identifies, joined to its account. */
interface DeviceRow {
  /** SHA-256 of the presented token, hex. The device's primary key, and what
   *  makes the token itself unrecoverable from the database. */
  token_hash: string;
  /** The account every one of this device's rows is scoped to. */
  user_id: string;
  /** What the device was called when it was registered. */
  name: string;
  /* This is what makes a token handed to the MCP server safe to hand over. */
  /** `full` or `words`. A `words` token may only use the word list. */
  scope: string;
  /** The account's verified address. */
  email: string;
}

/** The device behind this request's bearer token, or null for any token that
 *  does not identify a live device. Touches `last_seen` on both the device and
 *  the account as a side effect. */
async function authenticate(request: Request, env: Env): Promise<DeviceRow | null> {
  /* Null covers every failure alike — no header, wrong scheme, unknown token,
     revoked device — because telling them apart would tell a caller which of
     their guesses was a real token. Touching `last_seen` is what makes the
     device list useful. */
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT d.token_hash, d.user_id, d.name, d.scope, u.email
       FROM devices d JOIN users u ON u.id = d.user_id
      WHERE d.token_hash = ? AND d.revoked = 0`,
  )
    .bind(hash)
    .first<DeviceRow>();
  if (!row) return null;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE devices SET last_seen = ? WHERE token_hash = ?').bind(now, hash),
    env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, row.user_id),
  ]);
  return row;
}

/** The account's sync counter. One row per account. */
interface CounterRow {
  /** The highest sequence number handed out so far. */
  value: number;
}

/** Reserves `count` consecutive sequence numbers for the account and returns
 *  the first of them. Numbers are per account, so one person's writes never
 *  advance another's pull cursor. Throws if the counter cannot be read back. */
async function nextSeq(env: Env, userId: string, count: number): Promise<number> {
  await env.DB.prepare(
    `INSERT INTO counter (user_id, value) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET value = value + ?`,
  )
    .bind(userId, count, count)
    .run();
  const row = await env.DB.prepare('SELECT value FROM counter WHERE user_id = ?')
    .bind(userId)
    .first<CounterRow>();
  /* The insert above has just created or advanced this row, so it is there.
     Saying so out loud rather than assuming it keeps an impossible D1 failure
     a 500 with a sentence on it, which is what it used to be when reading
     `.value` off null threw. */
  if (!row) throw new Error('the account counter vanished between two statements');
  return row.value - count;
}

/* A missing row is a 0 here and an error in `nextSeq`, which has just written
   one. */
/** The account's current sequence: what a device that pulled everything would
 *  hold. Zero for an account that has never written. */
const currentSeq = async (env: Env, userId: string): Promise<number> =>
  (
    await env.DB.prepare('SELECT value FROM counter WHERE user_id = ?')
      .bind(userId)
      .first<CounterRow>()
  )?.value ?? 0;

/* ----------------------------------------------------------------- login -- */

/** The opaque account id for this verified address, creating the account if
 *  this is the first time. Idempotent: signing in again only moves `last_seen`,
 *  so nothing is lost by logging in from a second device. */
async function ensureAccount(env: Env, email: string): Promise<string> {
  const id = await accountId(email);
  await env.DB.prepare(
    `INSERT INTO users (id, email, created, last_seen) VALUES (?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`,
  )
    .bind(id, email.trim().toLowerCase(), Date.now(), Date.now())
    .run();
  return id;
}

/** Mints a device token and stores only its hash. The returned `token` is the
 *  single time the raw value exists anywhere; it is not recoverable afterwards.
 *  `name` is stored trimmed to 60 characters. */
async function issueToken(
  env: Env,
  userId: string,
  name: string,
  scope: string,
): Promise<{ token: string; hash: string }> {
  /* 256 bits from the platform's generator, base64url so the token survives a
     URL fragment. */
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    'INSERT INTO devices (token_hash, user_id, name, scope, created) VALUES (?,?,?,?,?)',
  )
    .bind(hash, userId, name.slice(0, 60), scope, Date.now())
    .run();
  return { token, hash };
}

/** The identity Access verified for this request, or null. */
async function accessIdentity(
  request: Request,
  env: Env,
): Promise<{ email: string; payload: AccessPayload } | null> {
  const payload = await verifyAccessToken(tokenFromRequest(request), env);
  if (!payload) return null;
  const email = payload.email || payload.common_name;
  /* `verifyAccessToken` already refuses a payload with neither, so this is
     narrowing rather than a second check. */
  if (!email) return null;
  return { email, payload };
}

/** The redirect target resolved against this request's URL, or null when it is
 *  absent, unparseable, or on another origin. */
function safeRedirect(target: string | null, request: Request): URL | null {
  /* Only ever redirect back into this same app: an open redirect here would let
     another site collect a freshly minted token. */
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

/** `POST /v1/auth/request`: send a code to the address, if the limit allows. */
async function requestCode(request: Request, env: Env): Promise<Response> {
  const body: RequestCodeBody = await readJsonObject(request);
  const email = normaliseEmail(body.email);
  if (!looksLikeEmail(email)) return fail(env, 400, 'that does not look like an email address');

  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT email, requests, window_start FROM login_codes WHERE email = ?',
  )
    .bind(email)
    .first<RateLimitRow>();
  const limit = rateLimit(row, now);
  if (!limit.allowed) {
    return reply(env, { error: `too many requests; try again in ${limit.retryIn}s` }, 429);
  }

  const code = generateCode();
  const codeHash = await hashCode(email, code, env.CODE_PEPPER || '');
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, expires, attempts, sent, requests, window_start)
     VALUES (?,?,?,0,?,?,?)
     ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires=excluded.expires,
       attempts=0, sent=excluded.sent, requests=excluded.requests,
       window_start=excluded.window_start`,
  )
    .bind(email, codeHash, now + CODE_TTL_MS, now, limit.requests, limit.windowStart)
    .run();

  try {
    await sendLoginCode(env, email, code);
  } catch (err) {
    return fail(env, 503, err instanceof Error ? err.message : String(err));
  }
  /* Always the same answer, so this cannot be used to discover who has an
     account. Accounts are created on first successful login anyway. */
  return reply(env, { sent: true, expiresIn: CODE_TTL_MS / 1000 });
}

/** `POST /v1/auth/verify`: trade a correct code for a device token. */
async function verifyCode(request: Request, env: Env): Promise<Response> {
  const body: VerifyCodeBody = await readJsonObject(request);
  const email = normaliseEmail(body.email);
  const code = bodyString(body.code).trim();
  if (!looksLikeEmail(email) || !code)
    return fail(env, 400, 'email and code are both required');

  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT email, code_hash, expires, attempts FROM login_codes WHERE email = ?',
  )
    .bind(email)
    .first<CodeRow>();
  const supplied = await hashCode(email, code, env.CODE_PEPPER || '');
  const verdict = checkCode(row, supplied, now);

  if (verdict.countAttempt) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?')
      .bind(email)
      .run();
  }
  if (verdict.destroy) {
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
  }
  if (!verdict.ok) return fail(env, 401, verdict.reason);

  const userId = await ensureAccount(env, email);
  const scope = body.scope === 'words' ? 'words' : 'full';
  const { token } = await issueToken(env, userId, deviceName(body.name, 'device'), scope);
  return reply(env, { token, scope, email });
}

/** A row of `passkeys` as the passkey list shows it. */
interface PasskeyListRow {
  /** The credential id, base64url; also what a delete addresses it by. */
  cred_id: string;
  /** The label it was saved under, or null on a row saved without one. */
  name: string | null;
  /** `singleDevice` or `multiDevice`, as the authenticator reported. */
  device_type: string | null;
  /** 1 when the passkey syncs through iCloud or Google. */
  backed_up: number;
  /** Milliseconds when it was enrolled. */
  created: number;
  /** Milliseconds at the last successful sign-in, or null if never. */
  last_used: number | null;
}

/** A row of `devices` as the device list shows it. */
interface DeviceListRow {
  /** SHA-256 of the token, hex. Only its first twelve characters are shown,
   *  which is enough to tell two devices apart and useless as a token. */
  token_hash: string;
  /** What the device was called when it was registered. */
  name: string;
  /** `full` or `words`. */
  scope: string;
  /** Milliseconds when the token was minted. */
  created: number;
  /** Milliseconds at the last request it made, or null. */
  last_seen: number | null;
  /** 1 once revoked. A revoked row is kept so the list can show it. */
  revoked: number;
}

/** Everything under `/v1/auth`: the two code endpoints, the passkey flows, the
 *  Access-guarded endpoints, and device management. Returns a 404 answer for
 *  any path or method it does not recognise. */
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
    const body = loginVerifyBody(await readJsonObject(request));
    const result = await verifyLogin(env, request, body);
    if (!result.ok) return fail(env, 401, result.error);
    const { token } = await issueToken(
      env,
      result.userId,
      deviceName(body.name, 'passkey device'),
      body.scope === 'words' ? 'words' : 'full',
    );
    return reply(env, { token, email: result.email });
  }
  if (path.startsWith('/passkey/register')) {
    const device = await authenticate(request, env);
    if (!device) {
      return fail(
        env,
        401,
        'sign in first: a passkey can only be added to an account you hold',
      );
    }
    if (path === '/passkey/register/options' && request.method === 'POST') {
      const { challengeId, options } = await registrationOptions(env, request, device);
      return reply(env, { challengeId, options });
    }
    if (path === '/passkey/register/verify' && request.method === 'POST') {
      const result = await verifyRegistration(
        env,
        request,
        device,
        registerVerifyBody(await readJsonObject(request)),
      );
      if (!result.ok) return fail(env, 400, result.error);
      return reply(env, result);
    }
  }
  if (path === '/passkeys' && request.method === 'GET') {
    const device = await authenticate(request, env);
    if (!device) return fail(env, 401, 'authenticate with a device token');
    const rows = await env.DB.prepare(
      `SELECT cred_id, name, device_type, backed_up, created, last_used
         FROM passkeys WHERE user_id = ? ORDER BY created`,
    )
      .bind(device.user_id)
      .all<PasskeyListRow>();
    return reply(env, {
      passkeys: rows.results.map((k) => ({
        id: k.cred_id,
        name: k.name,
        created: k.created,
        lastUsed: k.last_used,
        /* A backed-up passkey syncs through iCloud or Google; one that is not
           lives on a single device and is gone if that device is. */
        syncs: !!k.backed_up,
        deviceType: k.device_type,
      })),
    });
  }
  if (path.startsWith('/passkeys/') && request.method === 'DELETE') {
    const device = await authenticate(request, env);
    if (!device) return fail(env, 401, 'authenticate with a device token');
    const id = decodeURIComponent(path.slice('/passkeys/'.length));
    const res = await env.DB.prepare('DELETE FROM passkeys WHERE user_id = ? AND cred_id = ?')
      .bind(device.user_id, id)
      .run();
    return reply(env, { removed: res.meta.changes });
  }

  /* Everything under /v1/auth needs a verified Access identity. */
  if (path === '/session' || path === '/device' || path === '/start') {
    const identity = await accessIdentity(request, env);
    if (!identity) {
      return fail(
        env,
        401,
        env.ACCESS_TEAM_DOMAIN
          ? 'no valid Cloudflare Access session for this request'
          : 'Cloudflare Access is not configured on this deployment',
      );
    }

    if (path === '/session') {
      const userId = await ensureAccount(env, identity.email);
      return reply(env, { email: identity.email, account: userId });
    }

    if (path === '/device' && request.method === 'POST') {
      const body: DeviceBody = await readJsonObject(request);
      const scope = body.scope === 'words' ? 'words' : 'full';
      const userId = await ensureAccount(env, identity.email);
      const { token } = await issueToken(env, userId, deviceName(body.name, 'device'), scope);
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
           FROM devices WHERE user_id = ? ORDER BY created`,
      )
        .bind(device.user_id)
        .all<DeviceListRow>();
      return reply(env, {
        email: device.email,
        devices: rows.results.map((d) => ({
          id: d.token_hash.slice(0, 12),
          name: d.name,
          scope: d.scope,
          created: d.created,
          lastSeen: d.last_seen,
          revoked: !!d.revoked,
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
        WHERE user_id = ? AND substr(token_hash, 1, 12) = ?`,
    )
      .bind(device.user_id, id)
      .run();
    return reply(env, { revoked: res.meta.changes });
  }
  return fail(env, 404, 'no such endpoint');
}

/* ------------------------------------------------------------------ sync -- */

/** A pulled row: the record as it was pushed, and the sequence it was written
 *  at. The Worker reads the sequence and hands the record straight on. */
interface SyncRow {
  /** The pushed record, still JSON. */
  data: string;
  /** The sequence number the write was given. */
  seq: number;
}

/** `POST /v1/sync`: take this device's writes, then hand back everything past
 *  its cursor, a page of each table at a time. */
async function handleSync(request: Request, env: Env, user: string): Promise<Response> {
  const raw: unknown = await request.json();
  const body: SyncRequestBody = isJsonRecord(raw) ? raw : {};
  const since = Number(body.since || 0);
  const push = syncPush(body.push);
  const counts: Record<SyncTable, number> = { words: 0, cards: 0, reviews: 0, lessons: 0 };
  const writes: D1PreparedStatement[] = [];

  const total =
    (push.words?.length || 0) +
    (push.cards?.length || 0) +
    (push.reviews?.length || 0) +
    (push.lessons?.length || 0);
  let seq = total ? await nextSeq(env, user, total) : await currentSeq(env, user);

  for (const w of push.words || []) {
    writes.push(
      env.DB.prepare(
        `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, k) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, deleted=excluded.deleted, seq=excluded.seq
       WHERE excluded.updatedAt > words.updatedAt`,
      ).bind(user, w.k, JSON.stringify(w), w.updatedAt || 0, w.deleted ? 1 : 0, seq++),
    );
    counts.words++;
  }
  for (const c of push.cards || []) {
    writes.push(
      env.DB.prepare(
        `INSERT INTO cards (user_id, id, data, updatedAt, seq) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, id) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, seq=excluded.seq
       WHERE excluded.updatedAt > cards.updatedAt`,
      ).bind(user, c.id, JSON.stringify(c), c.updatedAt || 0, seq++),
    );
    counts.cards++;
  }
  for (const r of push.reviews || []) {
    writes.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO reviews (user_id, uid, data, ts, seq) VALUES (?,?,?,?,?)',
      ).bind(user, r.uid, JSON.stringify(r), r.ts || 0, seq++),
    );
    counts.reviews++;
  }
  for (const l of push.lessons || []) {
    writes.push(
      env.DB.prepare(
        `INSERT INTO lessons (user_id, id, data, updatedAt, seq) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, id) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, seq=excluded.seq
       WHERE excluded.updatedAt > lessons.updatedAt`,
      ).bind(user, String(l.id), JSON.stringify(l), l.updatedAt || 0, seq++),
    );
    counts.lessons++;
  }
  if (writes.length) await env.DB.batch(writes);

  /* A page at a time. The cursor handed back is the newest sequence the
     device now has *all of*: where a table filled its page there may be more
     behind it, so the cursor stops at that page's last row and `more` asks
     the device to come straight back for the rest. Handing back the current
     sequence regardless, as this used to, silently skipped everything past
     the first page for a device with a long history. */
  const pull: SyncPullWire = {};
  let cursor = await currentSeq(env, user);
  let more = false;
  for (const table of SYNC_TABLES) {
    /* Four queries, one after another on purpose. Firing them together would
       change nothing a device can see and would cost a D1 connection per
       table on the one request that is already the heaviest the API serves. */
    // oxlint-disable-next-line no-await-in-loop
    const rows = await env.DB.prepare(
      `SELECT data, seq FROM ${table} WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ${PAGE}`,
    )
      .bind(user, since)
      .all<SyncRow>();
    pull[table] = rows.results.map((r) => storedRecord(r.data));
    if (rows.results.length === PAGE) {
      cursor = Math.min(cursor, rows.results[rows.results.length - 1].seq);
      more = true;
    }
  }
  return reply(env, { cursor, more, pushed: counts, pull });
}

/* ------------------------------------------------------------- word list -- */

/** A row of any synced table when only the record itself is wanted. */
interface DataRow {
  /** The stored record, still JSON. */
  data: string;
}

/** `GET /v1/words`: the account's whole word list, unpaged, in write order.
 *  Tombstones are included only when the query carries `deleted=1`. */
async function listWords(env: Env, user: string, url: URL): Promise<Response> {
  /* Unpaged on purpose: this is the endpoint the MCP server reads, and a
     vocabulary is thousands of rows, not millions. */
  const includeDeleted = url.searchParams.get('deleted') === '1';
  const rows = await env.DB.prepare(
    `SELECT data FROM words WHERE user_id = ?${includeDeleted ? '' : ' AND deleted = 0'}
     ORDER BY seq`,
  )
    .bind(user)
    .all<DataRow>();
  return reply(env, { words: rows.results.map((r) => storedRecord(r.data)) });
}

/** `POST /v1/words`: write words in bulk, from a bare array or from
 *  `{ words: [...] }`. A word without an `updatedAt` is stamped now. */
async function putWords(env: Env, user: string, body: unknown): Promise<Response> {
  /* The bare array is still taken because the first clients sent one. Stamping
     an absent `updatedAt` is what lets a caller that does not keep clocks win
     over an older stored row rather than be silently dropped by the
     last-write-wins clause. */
  const incoming: WireUserWord[] = incomingWords(body);
  if (!incoming.length) return reply(env, { written: 0 });
  let seq = await nextSeq(env, user, incoming.length);
  const now = Date.now();
  await env.DB.batch(
    incoming.map((w) => {
      const record = { ...w, updatedAt: w.updatedAt || now };
      return env.DB.prepare(
        `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, k) DO UPDATE SET data=excluded.data,
         updatedAt=excluded.updatedAt, deleted=excluded.deleted, seq=excluded.seq
       WHERE excluded.updatedAt > words.updatedAt`,
      ).bind(
        user,
        record.k,
        JSON.stringify(record),
        record.updatedAt,
        record.deleted ? 1 : 0,
        seq++,
      );
    }),
  );
  return reply(env, { written: incoming.length });
}

/** `DELETE /v1/words/:key`: write a tombstone, not a deletion. The row stays,
 *  marked deleted and stamped now. */
async function deleteWord(env: Env, user: string, key: string): Promise<Response> {
  /* Keeping the row is what lets the deletion travel to the other devices
     instead of being resurrected by the next push from one that still has the
     word. */
  const seq = await nextSeq(env, user, 1);
  const now = Date.now();
  const record = { k: key, deleted: true, updatedAt: now };
  await env.DB.prepare(
    `INSERT INTO words (user_id, k, data, updatedAt, deleted, seq) VALUES (?,?,?,?,1,?)
     ON CONFLICT(user_id, k) DO UPDATE SET data=excluded.data,
       updatedAt=excluded.updatedAt, deleted=1, seq=excluded.seq`,
  )
    .bind(user, key, JSON.stringify(record), now, seq)
    .run();
  return reply(env, { deleted: key });
}

/** A `COUNT(*)` result. */
interface CountRow {
  /** The count, aliased `n` in every query that uses this. */
  n: number;
}

/** `GET /v1/progress`: how many rows of each table this account holds. The word
 *  count excludes tombstones; the other three exclude nothing. */
async function progressSummary(env: Env, user: string): Promise<Response> {
  /* A deleted word is gone from the vocabulary, whereas a review of a word
     since deleted still happened. */

  /** This account's rows in one table, all of them, or 0 if the table is
   *  empty. The name is interpolated, so it must never come from a request. */
  const count = async (table: string): Promise<number> =>
    (
      await env.DB.prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id = ?`)
        .bind(user)
        .first<CountRow>()
    )?.n ?? 0;
  return reply(env, {
    words:
      (
        await env.DB.prepare('SELECT COUNT(*) n FROM words WHERE user_id = ? AND deleted = 0')
          .bind(user)
          .first<CountRow>()
      )?.n ?? 0,
    cards: await count('cards'),
    reviews: await count('reviews'),
    lessons: await count('lessons'),
  });
}

/* ---------------------------------------------------------------- assets -- */

/** The built app, with the single-page fallback done here rather than by the
 *  asset server: a miss is answered with index.html as `text/html`. A 404 when
 *  no assets are bound. */
async function serveAsset(request: Request, env: Env): Promise<Response> {
  /* `not_found_handling` is "none" in `wrangler.jsonc` on purpose: with the
     single-page setting every path matches an asset, the Worker never runs, and
     `/v1/*` gets swallowed by index.html. The content type is restated because
     the asset server hands back whatever it inferred from the original path. */
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 404) return res;
  const url = new URL(request.url);
  url.pathname = '/index.html';
  const fallback = await env.ASSETS.fetch(new Request(url, request));
  return new Response(fallback.body, {
    status: fallback.status,
    headers: {
      ...Object.fromEntries(fallback.headers),
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

export default {
  /** The one entry point. Anything outside `/v1/` is the app; everything inside
   *  it is the API, and every API path but `/v1/health` and `/v1/auth/*` needs a
   *  device token. A throw anywhere below becomes a 500 carrying its message. */
  async fetch(request: Request, env: Env): Promise<Response> {
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
        return await deleteWord(
          env,
          user,
          decodeURIComponent(url.pathname.slice('/v1/words/'.length)),
        );
      }
      if (url.pathname === '/v1/progress' && request.method === 'GET') {
        return await progressSummary(env, user);
      }
    } catch (err) {
      /* The one refusal in this file that does not choose its own wording. */
      const message = isJsonRecord(err) ? err.message : undefined;
      return fail(env, 500, String(message || err));
    }
    return fail(env, 404, 'no such endpoint');
  },
} satisfies ExportedHandler<Env>;
