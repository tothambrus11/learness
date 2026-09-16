/** Letting an MCP client in: OAuth 2.1, as the MCP authorisation spec asks.
 *
 *  claude.ai and Claude Code will not take a pasted token. They discover this
 *  server's authorisation server from two well-known documents, register
 *  themselves as a client, send the learner's browser to be allowed in, and
 *  swap the code they are handed for a token — proving with PKCE that the
 *  client swapping it is the one that asked. What comes out the far end is
 *  an ordinary device token with the `words` scope: a row in `devices`,
 *  named after the client, listed and revoked from the app like a phone.
 *
 *  The approval screen is the app's own /connect/ page. `authorize` checks
 *  the client and sends the browser there with the request in the query
 *  string; the page has the learner sign in if they are not, shows what is
 *  being granted, and posts the request back to `approve` with the learner's
 *  own token. Everything is checked again there: the page only asks.
 *
 *  The rules — what a redirect address may be, how a request is read, how a
 *  verifier meets its challenge — are plain functions, tested as such. The
 *  handlers below are the plumbing around them.
 */
import type { Device, Env } from './env.js';
import { authenticate, issueToken, randomToken, sha256Hex } from './tokens.js';

/** The one scope a connector may hold. `full` is never issued this way: a
 *  client that could sync would be a device, and a device is logged in. */
export const CONNECTOR_SCOPE = 'words';
/** Where the MCP endpoint lives, relative to the origin. */
export const MCP_PATH = '/mcp';
/** How long an authorisation code may wait to be swapped. */
export const CODE_TTL_MS = 5 * 60 * 1000;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
/** These endpoints are spoken to by other servers and by browser-based
 *  clients on any origin; they carry bearer tokens, never cookies, so an
 *  open CORS policy gives nothing away. */
export const OPEN_CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-max-age': '86400',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...OPEN_CORS, ...headers } });
/** An OAuth error, in the shape RFC 6749 gives it. */
const oauthError = (status: number, error: string, description: string): Response =>
  json({ error, error_description: description }, status);

/* ---------------------------------------------------------------- rules -- */

/** Where a client may be sent back to: https anywhere, or plain http on the
 *  machine itself, which is how Claude Code listens. Never a fragment, never
 *  anything else. An open redirect here would hand a fresh code to whoever
 *  registered the address. */
export function validRedirectUri(uri: string): boolean {
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/** Does `verifier` answer `challenge`, S256 — the only method allowed. */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (verifier.length < 43 || verifier.length > 128) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return encoded === challenge;
}

/** An authorisation request, read and checked. `resource` is the MCP
 *  endpoint the client means to use the token at (RFC 8707); when given it
 *  must be this server's, so a token cannot be asked for on someone else's
 *  behalf. */
export interface AuthorizeRequest {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  scope: string;
  resource: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; description: string };

/** The fields the connect page carries over, in order. */
export const REQUEST_FIELDS = ['client_id', 'redirect_uri', 'response_type', 'state',
  'code_challenge', 'code_challenge_method', 'scope', 'resource'] as const;

const same = (a: string, b: string): boolean => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** Read the request from a query string or a JSON body. Every failure names
 *  the field, because the client will show the message to a person. */
export function parseAuthorizeRequest(
  get: (name: string) => string, origin: string,
): Parsed<AuthorizeRequest> {
  const client_id = get('client_id').trim();
  const redirect_uri = get('redirect_uri').trim();
  if (!client_id) return { ok: false, error: 'invalid_request', description: 'client_id is required' };
  if (!validRedirectUri(redirect_uri)) {
    return { ok: false, error: 'invalid_request', description: 'redirect_uri is missing or not allowed' };
  }
  if (get('response_type') !== 'code') {
    return { ok: false, error: 'unsupported_response_type', description: 'only response_type=code is supported' };
  }
  const code_challenge = get('code_challenge').trim();
  if (!code_challenge) {
    return { ok: false, error: 'invalid_request', description: 'code_challenge is required (PKCE)' };
  }
  if ((get('code_challenge_method') || 'S256') !== 'S256') {
    return { ok: false, error: 'invalid_request', description: 'code_challenge_method must be S256' };
  }
  const scopes = get('scope').split(/\s+/).filter(Boolean);
  if (scopes.some((s) => s !== CONNECTOR_SCOPE)) {
    return { ok: false, error: 'invalid_scope', description: `the only scope offered is "${CONNECTOR_SCOPE}"` };
  }
  const resource = get('resource').trim();
  if (resource && !same(resource, origin + MCP_PATH)) {
    return { ok: false, error: 'invalid_target', description: `resource must be ${origin}${MCP_PATH}` };
  }
  return { ok: true, value: { client_id, redirect_uri, state: get('state'), code_challenge,
    scope: CONNECTOR_SCOPE, resource } };
}

/* ------------------------------------------------------------- metadata -- */

/** RFC 9728: where the MCP endpoint says who may vouch for a token. */
export const resourceMetadata = (origin: string): Record<string, unknown> => ({
  resource: origin + MCP_PATH,
  authorization_servers: [origin],
  scopes_supported: [CONNECTOR_SCOPE],
  bearer_methods_supported: ['header'],
  resource_name: 'Learness word list',
});

/** RFC 8414: the authorisation server, which is this same Worker. */
export const serverMetadata = (origin: string): Record<string, unknown> => ({
  issuer: origin,
  authorization_endpoint: `${origin}/v1/oauth/authorize`,
  token_endpoint: `${origin}/v1/oauth/token`,
  registration_endpoint: `${origin}/v1/oauth/register`,
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: [CONNECTOR_SCOPE],
  service_documentation: `${origin}/connect/`,
});

/** The two well-known documents, or null for a path that is neither. */
export function wellKnown(url: URL): Response | null {
  const origin = url.origin;
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/.well-known/oauth-authorization-server'
    || path === `/.well-known/oauth-authorization-server${MCP_PATH}`) {
    return json(serverMetadata(origin), 200, { 'cache-control': 'public, max-age=3600' });
  }
  if (path === '/.well-known/oauth-protected-resource'
    || path === `/.well-known/oauth-protected-resource${MCP_PATH}`) {
    return json(resourceMetadata(origin), 200, { 'cache-control': 'public, max-age=3600' });
  }
  return null;
}

/** What a request to /mcp without a usable token is told: where to go to
 *  get one. The header is what makes a client start the flow by itself. */
export const unauthorised = (origin: string, description: string): Response =>
  json({ error: 'invalid_token', error_description: description }, 401, {
    'www-authenticate': `Bearer realm="learness", error="invalid_token", `
      + `resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  });

/* ---------------------------------------------------------------- store -- */

interface Client { client_id: string; name: string; redirect_uris: string }

const clientOf = async (env: Env, id: string): Promise<Client | null> =>
  id ? env.DB.prepare('SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id = ?')
    .bind(id).first<Client>() : null;

const allowsRedirect = (client: Client, uri: string): boolean =>
  (JSON.parse(client.redirect_uris) as string[]).includes(uri);

/** A request body as JSON or as a form, whichever was sent: OAuth speaks
 *  forms, MCP clients sometimes speak JSON, and both are read the same way. */
async function bodyFields(request: Request): Promise<(name: string) => string> {
  const type = request.headers.get('content-type') || '';
  let values: Record<string, unknown> = {};
  try {
    if (type.includes('application/json')) {
      values = (await request.json()) as Record<string, unknown>;
    } else {
      const text = await request.text();
      values = Object.fromEntries(new URLSearchParams(text));
    }
  } catch {
    values = {};
  }
  return (name) => {
    const v = values[name];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(String).join(' ');
    return '';
  };
}

/* ------------------------------------------------------------- handlers -- */

/** RFC 7591: a client says who it is and where it may be sent back to. Open
 *  by design — the spec wants no credential here — and harmless: a client
 *  can do nothing until a person allows it on /connect/. */
async function register(request: Request, env: Env): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(400, 'invalid_redirect_uri',
      'redirect_uris must be one to ten https addresses, or http on localhost');
  }
  const auth = body.token_endpoint_auth_method;
  if (auth !== undefined && auth !== 'none') {
    return oauthError(400, 'invalid_client_metadata',
      'this server issues no client secrets: token_endpoint_auth_method must be "none"');
  }
  const name = (typeof body.client_name === 'string' && body.client_name.trim()) || 'MCP client';
  const client_id = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO oauth_clients (client_id, name, redirect_uris, created) VALUES (?,?,?,?)')
    .bind(client_id, name.slice(0, 60), JSON.stringify(uris), now).run();
  return json({
    client_id, client_id_issued_at: Math.floor(now / 1000), client_name: name.slice(0, 60),
    redirect_uris: uris, token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'], response_types: ['code'],
  }, 201);
}

/** Send the browser to the app's approval page with the request in the
 *  query string. The client and its redirect address are checked here, and
 *  a failure of those is answered in place: a code is never sent to an
 *  address that was not registered. Any other fault goes back to the client
 *  the way OAuth says, with the state it sent. */
async function authorize(request: Request, env: Env, url: URL): Promise<Response> {
  const get = request.method === 'POST'
    ? await bodyFields(request)
    : (name: string): string => url.searchParams.get(name) ?? '';
  const client = await clientOf(env, get('client_id').trim());
  const redirect = get('redirect_uri').trim();
  if (!client) return oauthError(400, 'invalid_request', 'unknown client_id: register first');
  if (!validRedirectUri(redirect) || !allowsRedirect(client, redirect)) {
    return oauthError(400, 'invalid_request', 'redirect_uri was not registered by this client');
  }
  const parsed = parseAuthorizeRequest(get, url.origin);
  if (!parsed.ok) {
    const back = new URL(redirect);
    back.searchParams.set('error', parsed.error);
    back.searchParams.set('error_description', parsed.description);
    if (get('state')) back.searchParams.set('state', get('state'));
    return Response.redirect(back.toString(), 302);
  }
  const page = new URL('/connect/', url.origin);
  for (const field of REQUEST_FIELDS) page.searchParams.set(field, get(field));
  page.searchParams.set('code_challenge_method', 'S256');
  page.searchParams.set('response_type', 'code');
  page.searchParams.set('client_name', client.name);
  return Response.redirect(page.toString(), 302);
}

/** The learner allowed it. Mint a code bound to this client, this redirect
 *  address and this challenge, and say where to send the browser. The
 *  learner's own token is what authenticates this call — the connect page
 *  runs inside the app, signed in. */
async function approve(request: Request, env: Env, url: URL, device: Device): Promise<Response> {
  const get = await bodyFields(request);
  const client = await clientOf(env, get('client_id').trim());
  if (!client) return oauthError(400, 'invalid_request', 'unknown client_id');
  const parsed = parseAuthorizeRequest(get, url.origin);
  if (!parsed.ok) return oauthError(400, parsed.error, parsed.description);
  if (!allowsRedirect(client, parsed.value.redirect_uri)) {
    return oauthError(400, 'invalid_request', 'redirect_uri was not registered by this client');
  }
  const code = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires < ?').bind(now),
    env.DB.prepare(
      `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, expires)
       VALUES (?,?,?,?,?,?,?)`)
      .bind(await sha256Hex(code), client.client_id, device.user_id, parsed.value.redirect_uri,
        parsed.value.code_challenge, parsed.value.scope, now + CODE_TTL_MS),
  ]);
  const back = new URL(parsed.value.redirect_uri);
  back.searchParams.set('code', code);
  if (parsed.value.state) back.searchParams.set('state', parsed.value.state);
  return json({ redirect: back.toString() });
}

/** Swap a code for a token. The code is destroyed first, so a second swap
 *  finds nothing; the verifier must answer the challenge the code was minted
 *  with; the client and the redirect address must be the ones that asked.
 *  The token never expires and there is no refresh token: it is a device,
 *  revoked from the app when it is no longer wanted. */
async function token(request: Request, env: Env): Promise<Response> {
  const get = await bodyFields(request);
  const grant = get('grant_type');
  if (grant !== 'authorization_code') {
    return oauthError(400, 'unsupported_grant_type',
      'only authorization_code is supported; the token does not expire, so there is nothing to refresh');
  }
  const code = get('code').trim();
  if (!code) return oauthError(400, 'invalid_request', 'code is required');
  const hash = await sha256Hex(code);
  const row = await env.DB.prepare(
    `SELECT c.client_id, c.user_id, c.redirect_uri, c.code_challenge, c.scope, c.expires, k.name
       FROM oauth_codes c JOIN oauth_clients k ON k.client_id = c.client_id
      WHERE c.code_hash = ?`).bind(hash).first<{
        client_id: string; user_id: string; redirect_uri: string; code_challenge: string;
        scope: string; expires: number; name: string;
      }>();
  /* Single use, whatever else is wrong with the request: a code that was
     tried is a code that is gone. */
  const gone = await env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').bind(hash).run();
  if (!row || !gone.meta.changes) return oauthError(400, 'invalid_grant', 'unknown or already used code');
  if (row.expires < Date.now()) return oauthError(400, 'invalid_grant', 'the code has expired');
  if (get('client_id').trim() !== row.client_id) {
    return oauthError(400, 'invalid_grant', 'the code was issued to another client');
  }
  const redirect = get('redirect_uri').trim();
  if (redirect && redirect !== row.redirect_uri) {
    return oauthError(400, 'invalid_grant', 'redirect_uri does not match the authorisation request');
  }
  if (!(await pkceMatches(get('code_verifier'), row.code_challenge))) {
    return oauthError(400, 'invalid_grant', 'code_verifier does not match the code_challenge');
  }
  const issued = await issueToken(env, row.user_id, row.name, CONNECTOR_SCOPE);
  return json({ access_token: issued.token, token_type: 'Bearer', scope: row.scope });
}

/** Everything under /v1/oauth. */
export async function handleOAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.slice('/v1/oauth'.length).replace(/\/+$/, '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: OPEN_CORS });
  if (path === '/register' && request.method === 'POST') return register(request, env);
  if (path === '/authorize' && (request.method === 'GET' || request.method === 'POST')) {
    return authorize(request, env, url);
  }
  if (path === '/approve' && request.method === 'POST') {
    const device = await authenticate(request, env);
    if (!device) return oauthError(401, 'invalid_token', 'sign in first');
    return approve(request, env, url, device);
  }
  if (path === '/token' && request.method === 'POST') return token(request, env);
  return oauthError(404, 'invalid_request', 'no such endpoint');
}
