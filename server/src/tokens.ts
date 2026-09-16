/** Accounts, and the device tokens that name them.
 *
 *  Every request past login carries a long-lived bearer token. Only its hash
 *  is stored, so the table is not a list of working keys; a row per device
 *  means a lost phone is one row to revoke, and a connector Claude holds is
 *  one row to revoke too — it appears under Devices like any other, named
 *  after the client that asked for it.
 *
 *  These lived inside worker.ts until the OAuth flow needed to mint a token
 *  as well. Two copies of "hash it, look it up, stamp last_seen" would drift.
 */
import { accountId } from './access.js';
import type { Device, Env } from './env.js';

/** What a token may do. `words` was made for the connector: the word list and
 *  where each word stands, never the review log and never a write to a card.
 *  `full` is a device of the learner's own, and syncs everything. */
export type Scope = 'full' | 'words';
export const SCOPES: readonly Scope[] = ['full', 'words'];
export const isScope = (value: unknown): value is Scope =>
  typeof value === 'string' && (SCOPES as readonly string[]).includes(value);

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32 random bytes as base64url: a token, an authorisation code, a client id. */
export function randomToken(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The token on a request, or empty. */
export function bearerOf(request: Request): string {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** The device a request's token names, or null when it names none — unknown,
 *  revoked, or absent. A hit stamps the device and the account as seen now. */
export async function authenticate(request: Request, env: Env): Promise<Device | null> {
  const token = bearerOf(request);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT d.token_hash, d.user_id, d.name, d.scope, u.email
       FROM devices d JOIN users u ON u.id = d.user_id
      WHERE d.token_hash = ? AND d.revoked = 0`).bind(hash).first<Device>();
  if (!row) return null;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE devices SET last_seen = ? WHERE token_hash = ?').bind(now, hash),
    env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, row.user_id),
  ]);
  return row;
}

/** The account for a verified email, created on first sight. The id is
 *  derived from the email the same way everywhere (see `accountId`), so a
 *  token minted by hand and a later login land on one account. */
export async function ensureAccount(env: Env, email: string): Promise<string> {
  const id = await accountId(email);
  await env.DB.prepare(
    `INSERT INTO users (id, email, created, last_seen) VALUES (?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`)
    .bind(id, email.trim().toLowerCase(), Date.now(), Date.now()).run();
  return id;
}

/** A new device token on an account. The token itself is returned once and
 *  never stored; the row keeps its hash. */
export async function issueToken(env: Env, userId: string, name: string, scope: Scope):
  Promise<{ token: string; hash: string }> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    'INSERT INTO devices (token_hash, user_id, name, scope, created) VALUES (?,?,?,?,?)')
    .bind(hash, userId, name.slice(0, 60), scope, Date.now()).run();
  return { token, hash };
}
