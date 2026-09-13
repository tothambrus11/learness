/** Verifying a Cloudflare Access identity.
 *
 *  Access handles the actual login: email one-time code, or Google or GitHub if
 *  you turn those on. It then puts a signed JWT on the request. This module
 *  checks that signature properly rather than trusting the header, because a
 *  header alone is trivially forged by anything that can reach the Worker
 *  directly.
 *
 *  Checked: RS256 signature against the team's published keys, issuer, audience
 *  (the Access application's AUD tag), and expiry.
 */

import type { Env } from './env.js';

/** What Access puts in a verified token. Only the fields this checks or uses
 *  are named; a token carries more. */
export interface AccessPayload {
  email?: string;
  common_name?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
}

interface JwtHeader { alg?: string; kid?: string }

const JWT_HEADER = 'Cf-Access-Jwt-Assertion';
const COOKIE = 'CF_Authorization';

/** A signing key as Access publishes it: a JWK with the id the token names. */
type SigningKey = JsonWebKey & { kid?: string };

let cache: { at: number; keys: SigningKey[] | null; domain: string | null } =
  { at: 0, keys: null, domain: null };
const CACHE_MS = 60 * 60 * 1000;

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const decodeJson = <T>(segment: string): T =>
  JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;

async function signingKeys(domain: string): Promise<SigningKey[]> {
  const now = Date.now();
  if (cache.keys && cache.domain === domain && now - cache.at < CACHE_MS) return cache.keys;
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`could not fetch Access keys (${res.status})`);
  const body = await res.json<{ keys?: SigningKey[] }>();
  const keys = body.keys ?? [];
  cache = { at: now, keys, domain };
  return keys;
}

export function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get(JWT_HEADER);
  if (header) return header;
  const cookies = request.headers.get('cookie') || '';
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookies);
  return match?.[1] ?? null;
}

/** Returns the verified payload, or null. Never throws on a bad token. */
export async function verifyAccessToken(
  token: string | null, env: Env,
): Promise<AccessPayload | null> {
  if (!token || !env.ACCESS_TEAM_DOMAIN) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  let header: JwtHeader;
  let payload: AccessPayload;
  try {
    header = decodeJson<JwtHeader>(rawHeader);
    payload = decodeJson<AccessPayload>(rawPayload);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;

  let keys: SigningKey[];
  try {
    keys = await signingKeys(env.ACCESS_TEAM_DOMAIN);
  } catch {
    return null;
  }
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return null;

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, base64UrlToBytes(rawSignature),
      new TextEncoder().encode(`${rawHeader}.${rawPayload}`));
  } catch {
    return null;
  }
  if (!verified) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  /* The AUD tag ties the token to this specific Access application. Without it
     a token minted for any other app on the same team would be accepted. */
  if (env.ACCESS_AUD) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
  }
  if (!payload.email && !payload.common_name) return null;
  return payload;
}

/** A stable, opaque account id. Derived from the email so the same person
 *  returning on a new device lands on the same account, and hashed so the row
 *  keys are not a list of addresses. */
export async function accountId(email: string): Promise<string> {
  const normalised = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`frcog:${normalised}`));
  return [...new Uint8Array(digest)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
