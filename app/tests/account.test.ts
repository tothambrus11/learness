import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp } from './harness.js';
import { asked, sent } from './make.js';

/** Sign-in, seen from the client: what it sends, and what it makes of what
 *  comes back. The server's own half is tested in server/tests. */
async function withServer(reply: {
  status?: number;
  body?: unknown;
} = {}): Promise<{
  passkey: typeof import('../src/lib/passkey.js');
  db: typeof import('../src/lib/db.js');
  calls: { url: string; body: unknown }[];
}> {
  const app = await freshApp();
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: asked(url), body: init?.body ? sent(init.body) : null });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' } });
  });
  const passkey = await import('../src/lib/passkey.js');
  return { passkey, db: app.db, calls };
}

test('an email code signs the device in and stores what it was given', async () => {
  const { passkey, db, calls } = await withServer(
    { body: { token: 'device-token', email: 'someone@example.test' } });
  const token = await passkey.signInWithEmailCode('someone@example.test', '123456', 'phone');
  assert.equal(token, 'device-token');
  assert.deepEqual(calls[0]?.body, { email: 'someone@example.test', code: '123456',
    name: 'phone' });
  const settings = await db.getSettings();
  assert.equal(settings.syncToken, 'device-token');
  assert.equal(settings.syncEmail, 'someone@example.test');
});

test('a wrong code is reported as the server explained it', async () => {
  const { passkey } = await withServer({ status: 400, body: { error: 'that code has expired' } });
  await assert.rejects(() => passkey.signInWithEmailCode('a@b.test', '000000'), /expired/);
});

test('the app being served without its API says so in words', async () => {
  /* What a bare `vite dev` looks like: every /v1 call 404s, and a status code
     explains nothing to the person who ran the wrong command. */
  const { passkey } = await withServer({ status: 404 });
  await assert.rejects(() => passkey.signInWithEmailCode('a@b.test', '000000'), /npm run dev/);
});

test('signing out forgets the credentials and keeps the learning', async () => {
  const { passkey, db } = await withServer({ body: { token: 't', email: 'a@b.test' } });
  await passkey.signInWithEmailCode('a@b.test', '123456');
  await passkey.signOut();
  const settings = await db.getSettings();
  assert.equal(settings.syncToken, '');
  assert.equal(settings.syncEmail, '');
  assert.equal(settings.syncCursor, 0);
});

test('passkeys are refused where the browser cannot do them', async () => {
  const { passkey } = await withServer();
  assert.equal(passkey.passkeysAvailable(), false, 'no PublicKeyCredential here');
  assert.equal(await passkey.autofillAvailable(), false);
  await assert.rejects(() => passkey.signInWithPasskey(), /cannot use passkeys/);
});

test('the voice will not start where nothing can run it', async () => {
  await freshApp();
  const { voiceDecision } = await import('../src/lib/voice.js');
  const d = await voiceDecision();
  assert.equal('no' in d, true, 'Node has no Worker, so there is nothing to ask about');
  assert.match((d as { reason: string }).reason, /cannot run the voice/);
});
