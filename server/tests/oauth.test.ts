/** Letting an MCP client in.
 *
 *  The rules as plain functions, then the whole flow through the Worker:
 *  register, be sent to /connect/, approve with the learner's own token,
 *  swap the code, and use the token at /mcp. Every step that must fail —
 *  a wrong verifier, a second swap, an unregistered return address — fails
 *  here, against the real SQL.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseAuthorizeRequest, pkceMatches, resourceMetadata, serverMetadata, validRedirectUri,
} from '../src/oauth.js';
import { harness, ORIGIN } from './env.js';

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

test('a client may be sent back to https, or to its own machine, and nowhere else', () => {
  assert.equal(validRedirectUri(CLAUDE), true);
  assert.equal(validRedirectUri('http://localhost:3334/callback'), true);
  assert.equal(validRedirectUri('http://127.0.0.1:8080/'), true);
  assert.equal(validRedirectUri('http://example.com/cb'), false, 'plain http off the machine');
  assert.equal(validRedirectUri('https://claude.ai/cb#frag'), false, 'a fragment is not a place');
  assert.equal(validRedirectUri('javascript:alert(1)'), false);
  assert.equal(validRedirectUri('not a url'), false);
});

test('a verifier answers its S256 challenge, and only that', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'.padEnd(43, 'x');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(await pkceMatches(verifier, challenge), true);
  assert.equal(await pkceMatches(`${verifier}x`, challenge), false);
  assert.equal(await pkceMatches('short', challenge), false, 'below the minimum length');
});

test('an authorisation request is read field by field, and each fault is named', () => {
  const good: Record<string, string> = {
    client_id: 'c1', redirect_uri: CLAUDE, response_type: 'code', state: 's',
    code_challenge: 'abc', code_challenge_method: 'S256', scope: 'words', resource: `${ORIGIN}/mcp`,
  };
  const parse = (over: Record<string, string>) =>
    parseAuthorizeRequest((n) => ({ ...good, ...over })[n] ?? '', ORIGIN);
  assert.equal(parse({}).ok, true);
  assert.equal(parse({ scope: '' }).ok, true, 'no scope asked means the one scope');
  assert.equal(parse({ resource: `${ORIGIN}/mcp/` }).ok, true, 'a trailing slash is the same place');
  assert.equal(parse({ code_challenge_method: '' }).ok, true, 'S256 is assumed');
  for (const [over, error] of [
    [{ client_id: '' }, 'invalid_request'],
    [{ redirect_uri: 'http://evil.example/cb' }, 'invalid_request'],
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge: '' }, 'invalid_request'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ scope: 'full' }, 'invalid_scope'],
    [{ resource: 'https://elsewhere.example/mcp' }, 'invalid_target'],
  ] as const) {
    const r = parse(over);
    assert.equal(r.ok, false, JSON.stringify(over));
    assert(!r.ok);
    assert.equal(r.error, error, JSON.stringify(over));
  }
});

test('the well-known documents point a client at this same Worker', async () => {
  const h = harness();
  const as = await (await h.fetch('/.well-known/oauth-authorization-server')).json<Record<string, unknown>>();
  assert.deepEqual(as, serverMetadata(ORIGIN));
  assert.equal(as.issuer, ORIGIN);
  assert.equal(as.token_endpoint, `${ORIGIN}/v1/oauth/token`);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  const pr = await (await h.fetch('/.well-known/oauth-protected-resource/mcp')).json<Record<string, unknown>>();
  assert.deepEqual(pr, resourceMetadata(ORIGIN));
  assert.deepEqual(pr.authorization_servers, [ORIGIN]);
  const res = await h.fetch('/.well-known/oauth-protected-resource');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('/mcp without a token says where to get one', async () => {
  const res = await harness().fetch('/mcp', { method: 'POST', json: { jsonrpc: '2.0', id: 1, method: 'ping' } });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') ?? '',
    /resource_metadata="https:\/\/learness\.test\/\.well-known\/oauth-protected-resource"/);
});

/** The client's half of PKCE. */
async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = 'v'.repeat(43) + Math.random().toString(36).slice(2);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

async function register(h: ReturnType<typeof harness>, uris = [CLAUDE], name = 'Claude') {
  const res = await h.fetch('/v1/oauth/register', { method: 'POST',
    json: { client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none' } });
  return { status: res.status, body: await res.json<Record<string, unknown>>() };
}

test('the whole way in: register, be sent to connect, approve, swap the code, use the token', async () => {
  const h = harness();
  const { status, body: client } = await register(h);
  assert.equal(status, 201);
  assert.equal(client.token_endpoint_auth_method, 'none');
  assert.equal(typeof client.client_id, 'string');
  const clientId = client.client_id as string;
  const { verifier, challenge } = await pkce();

  /* authorize: the browser is sent to the app's page with the request intact. */
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CLAUDE,
    state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256', scope: 'words',
    resource: `${ORIGIN}/mcp` });
  const sent = await h.fetch(`/v1/oauth/authorize?${q.toString()}`, { redirect: 'manual' });
  assert.equal(sent.status, 302);
  const page = new URL(sent.headers.get('location')!);
  assert.equal(page.pathname, '/connect/');
  assert.equal(page.searchParams.get('client_name'), 'Claude');
  assert.equal(page.searchParams.get('code_challenge'), challenge);
  assert.equal(page.searchParams.get('state'), 'xyz');

  /* approve: the page posts the request back with the learner's token. */
  const { token: mine } = await h.signIn();
  const request = Object.fromEntries(page.searchParams);
  delete request.client_name;
  const denied = await h.fetch('/v1/oauth/approve', { method: 'POST', json: request });
  assert.equal(denied.status, 401, 'signing in is what approving means');
  const approved = await h.fetch('/v1/oauth/approve', { method: 'POST', json: request, token: mine });
  assert.equal(approved.status, 200);
  const back = new URL((await approved.json<{ redirect: string }>()).redirect);
  assert.equal(back.origin + back.pathname, CLAUDE);
  assert.equal(back.searchParams.get('state'), 'xyz');
  const code = back.searchParams.get('code')!;
  assert.ok(code.length > 20);

  /* token: a wrong verifier burns the code... */
  const form = (over: Record<string, string>) => new URLSearchParams({ grant_type: 'authorization_code',
    code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: verifier, ...over }).toString();
  const wrong = await h.fetch('/v1/oauth/token', { method: 'POST', body: form({ code_verifier: 'x'.repeat(50) }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json<{ error: string }>()).error, 'invalid_grant');
  const again = await h.fetch('/v1/oauth/token', { method: 'POST', body: form({}),
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(again.status, 400, 'a code that was tried is a code that is gone');

  /* ...so approve once more and swap it properly. */
  const approved2 = await h.fetch('/v1/oauth/approve', { method: 'POST', json: request, token: mine });
  const code2 = new URL((await approved2.json<{ redirect: string }>()).redirect).searchParams.get('code') ?? '';
  const swapped = await h.fetch('/v1/oauth/token', { method: 'POST', body: form({ code: code2 }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(swapped.status, 200);
  const issued = await swapped.json<{ access_token: string; token_type: string; scope: string }>();
  assert.equal(issued.token_type, 'Bearer');
  assert.equal(issued.scope, 'words');
  assert.equal(swapped.headers.get('cache-control'), 'no-store');
  const replay = await h.fetch('/v1/oauth/token', { method: 'POST', body: form({ code: code2 }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(replay.status, 400, 'single use');

  /* The token is a device named after the client, with the words scope... */
  const devices = await (await h.fetch('/v1/auth/devices', { token: mine })).json<{
    devices: { name: string; scope: string }[];
  }>();
  assert.deepEqual(devices.devices.map((d) => [d.name, d.scope]), [['test phone', 'full'], ['Claude', 'words']]);
  /* ...which /mcp accepts and /v1/sync does not. */
  const pong = await h.fetch('/mcp', { method: 'POST', token: issued.access_token,
    json: { jsonrpc: '2.0', id: 1, method: 'ping' } });
  assert.equal(pong.status, 200);
  assert.deepEqual(await pong.json(), { jsonrpc: '2.0', id: 1, result: {} });
  const sync = await h.fetch('/v1/sync', { method: 'POST', token: issued.access_token, json: {} });
  assert.equal(sync.status, 403);
});

test('a code is never sent to an address the client did not register', async () => {
  const h = harness();
  const { body: client } = await register(h);
  const { challenge } = await pkce();
  const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id as string,
    redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' });
  const res = await h.fetch(`/v1/oauth/authorize?${q.toString()}`, { redirect: 'manual' });
  assert.equal(res.status, 400, 'answered in place, not redirected');
  const unknown = await h.fetch(`/v1/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(q),
    client_id: 'nobody' }).toString()}`, { redirect: 'manual' });
  assert.equal(unknown.status, 400);
  /* The approve step checks it too: the page only asks. */
  const { token: mine } = await h.signIn();
  const approved = await h.fetch('/v1/oauth/approve', { method: 'POST', token: mine, json: {
    client_id: client.client_id, redirect_uri: 'https://evil.example/cb', response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256' } });
  assert.equal(approved.status, 400);
});

test('a fault in the request goes back to the registered client, with its state', async () => {
  const h = harness();
  const { body: client } = await register(h);
  const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id as string,
    redirect_uri: CLAUDE, state: 'st', scope: 'full', code_challenge: 'abc' });
  const res = await h.fetch(`/v1/oauth/authorize?${q.toString()}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const back = new URL(res.headers.get('location')!);
  assert.equal(back.origin + back.pathname, CLAUDE);
  assert.equal(back.searchParams.get('error'), 'invalid_scope');
  assert.equal(back.searchParams.get('state'), 'st');
});

test('registration refuses what it cannot honour', async () => {
  const h = harness();
  assert.equal((await register(h, [])).status, 400);
  assert.equal((await register(h, ['http://example.com/cb'])).status, 400);
  const secret = await h.fetch('/v1/oauth/register', { method: 'POST',
    json: { redirect_uris: [CLAUDE], token_endpoint_auth_method: 'client_secret_basic' } });
  assert.equal(secret.status, 400);
  const nameless = await register(h, [CLAUDE], '');
  assert.equal(nameless.body.client_name, 'MCP client');
  const refresh = await h.fetch('/v1/oauth/token', { method: 'POST',
    body: 'grant_type=refresh_token&refresh_token=x',
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal((await refresh.json<{ error: string }>()).error, 'unsupported_grant_type');
});
