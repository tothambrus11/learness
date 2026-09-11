/** Verifying a Cloudflare Access identity. Checked on every token: the RS256
 *  signature against the team's published keys, the issuer, the audience (the
 *  Access application's AUD tag), and expiry — a header alone is trivially
 *  forged by anything that can reach the Worker directly. */
import type { Env } from './env';

/** The header Access puts the assertion on when the request reaches a Worker. */
const JWT_HEADER = 'Cf-Access-Jwt-Assertion';

/** The cookie Access sets in a browser, carrying the same assertion. */
const COOKIE = 'CF_Authorization';

/** The JWT header, as far as this module reads it. */
interface JwtHeader {
  /** The signing algorithm. Only RS256 is accepted: honouring whatever the
   *  token asks for is how `alg: none` forgeries get in. */
  alg?: string;
  /** Which of the team's published keys signed this token. */
  kid?: string;
}

/** The claims this module reads. Access puts more in the token; the rest rides
 *  along unread. */
export interface AccessPayload {
  /** The verified address, on a token minted for a person. */
  email?: string;
  /** The service-token name, on a token minted for a machine. One of this and
   *  `email` is always present — a payload with neither is refused. */
  common_name?: string;
  /** Expiry, in Unix seconds. */
  exp?: number;
  /** Not-valid-before, in Unix seconds. Allowed a minute of clock skew. */
  nbf?: number;
  /** The issuer, which must be exactly `https://<team domain>`. */
  iss?: string;
  /** The AUD tag(s) of the Access application the token was minted for. */
  aud?: string | string[];
}

/** The team's published signing keys, as `/cdn-cgi/access/certs` returns them. */
interface AccessCerts {
  /** The JWKs, one per key Access is currently signing with. Each carries a
   *  `kid`, which is what a token's own `kid` is matched against. Absent is
   *  treated as none, which fails every verification rather than passing it. */
  keys?: JsonWebKeyWithKid[];
}

/** True when a decoded segment is a JSON object at all: not null, not an array,
 *  not a bare number or string. */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when an optional claim is absent or a string. */
const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';

/** True when an optional claim is absent or a number. */
const optionalNumber = (value: unknown): boolean =>
  value === undefined || typeof value === 'number';

/** True when the decoded first segment is a usable JWT header: an object whose
 *  `alg` and `kid` are absent or strings. Shape only — whether the algorithm is
 *  one this module accepts, and whether the key it names exists, are decided by
 *  `verifyAccessToken()`. */
function isJwtHeader(value: unknown): value is JwtHeader {
  return isObject(value) && optionalString(value.alg) && optionalString(value.kid);
}

/** True when the decoded second segment holds claims of the kinds this module
 *  compares. An `exp` or `nbf` that did not arrive as a number is refused. */
function isAccessPayload(value: unknown): value is AccessPayload {
  if (!isObject(value)) return false;
  const audOk =
    value.aud === undefined ||
    typeof value.aud === 'string' ||
    (Array.isArray(value.aud) && value.aud.every((a) => typeof a === 'string'));
  return (
    optionalString(value.email) &&
    optionalString(value.common_name) &&
    optionalNumber(value.exp) &&
    optionalNumber(value.nbf) &&
    optionalString(value.iss) &&
    audOk
  );
}

/** The signing keys held between requests, keyed by domain as well as by time,
 *  so a deployment re-pointed at another Access team does not go on trusting
 *  the old team's keys for the rest of the hour. */
interface KeyCache {
  /** Milliseconds when the keys were fetched. */
  at: number;
  /** The keys, or null before the first fetch. */
  keys: JsonWebKeyWithKid[] | null;
  /** The team domain they were fetched from, or null before the first fetch. */
  domain: string | null;
}

/** The one cache entry, replaced whole on every fetch. Empty until the first. */
let cache: KeyCache = { at: 0, keys: null, domain: null };

/** How long a fetched set of keys is reused for, in milliseconds. */
const CACHE_MS = 60 * 60 * 1000;

/** Base64url, as JWTs use it, decoded to the bytes it stands for. */
function base64UrlToBytes(input: string): Uint8Array {
  /* Padding is added back because `atob` insists on it and JWT segments never
     carry it. */
  const padded = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One base64url JWT segment, decoded as JSON. Returns whatever was in it — the
 *  caller says what it expected and checks. Throws on a segment that is not
 *  base64url or not JSON. */
const decodeJson = (segment: string): unknown =>
  JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));

/** The team's current signing keys, cached for an hour. Throws when the fetch
 *  fails, so an outage at Cloudflare is a refusal to verify rather than an
 *  empty key list cached for the next hour. */
async function signingKeys(domain: string): Promise<JsonWebKeyWithKid[]> {
  const now = Date.now();
  if (cache.keys && cache.domain === domain && now - cache.at < CACHE_MS) return cache.keys;
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`could not fetch Access keys (${res.status})`);
  const body = await res.json<AccessCerts>();
  const keys = body.keys || [];
  cache = { at: now, keys, domain };
  return keys;
}

/** The Access assertion on this request, from the header or the cookie, or
 *  null when there is none. Unverified: this only finds the token. */
export function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get(JWT_HEADER);
  if (header) return header;
  const cookies = request.headers.get('cookie') || '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

/** The payload of a token that verified, or null for one that did not. Never
 *  throws on a bad token; a missing token or an unconfigured team domain is
 *  null too. */
export async function verifyAccessToken(
  token: string | null,
  env: Env,
): Promise<AccessPayload | null> {
  if (!token || !env.ACCESS_TEAM_DOMAIN) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSignature] = parts;

  let header: unknown;
  let payload: unknown;
  try {
    header = decodeJson(rawHeader);
    payload = decodeJson(rawPayload);
  } catch {
    return null;
  }
  if (!isJwtHeader(header) || !isAccessPayload(payload)) return null;
  if (header.alg !== 'RS256') return null;

  let keys: JsonWebKeyWithKid[];
  try {
    keys = await signingKeys(env.ACCESS_TEAM_DOMAIN);
  } catch {
    return null;
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(rawSignature),
      new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
    );
  } catch {
    return null;
  }
  if (!verified) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  /* Unchecked, a token minted for any other app on the same team is accepted. */
  if (env.ACCESS_AUD) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
  }
  if (!payload.email && !payload.common_name) return null;
  return payload;
}

/** A stable, opaque account id: the first sixteen bytes of a SHA-256 over the
 *  trimmed, lower-cased address, as hex. Derived from the address so the same
 *  person on a new device lands on the same account, and hashed so the row keys
 *  are not a list of addresses. */
export async function accountId(email: string): Promise<string> {
  const normalised = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`frcog:${normalised}`),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
