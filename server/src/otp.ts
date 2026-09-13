/** Email one-time codes.
 *
 *  A six-digit code is only a million possibilities, so hashing it in the
 *  database is not what makes this safe. The protections that matter are the
 *  short life, the small number of attempts before the code is destroyed, and
 *  the limit on how often one address can ask for a new one. Hashing is there
 *  so that reading the table does not show live codes.
 */

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_REQUESTS_PER_WINDOW = 3;

export const normaliseEmail = (email: unknown): string =>
  (typeof email === 'string' ? email : '').trim().toLowerCase();

/** Rejects the obviously malformed. Real validation is delivery: a typo means
 *  the code never arrives. */
export function looksLikeEmail(email: unknown): boolean {
  const e = normaliseEmail(email);
  return e.length >= 6 && e.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(e);
}

/** Uniform over 000000-999999. Rejection sampling rather than a modulo, which
 *  would make some codes likelier than others. */
export function generateCode(
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const limit = 4294967295 - (4294967296 % 1000000);
  for (;;) {
    const b = random(4);
    const value = (((b[0] ?? 0) << 24) >>> 0) + ((b[1] ?? 0) << 16)
      + ((b[2] ?? 0) << 8) + (b[3] ?? 0);
    if (value <= limit) return String(value % 1000000).padStart(6, '0');
  }
}

export async function hashCode(email: unknown, code: string, pepper = ''): Promise<string> {
  const data = new TextEncoder().encode(`${normaliseEmail(email)}:${code}:${pepper}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent comparison, so a mismatch cannot be timed. */
export function constantTimeEqual(a: unknown, b: unknown): boolean {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** One address's recent requests, as the table keeps them. */
export interface RateRow { window_start: number; requests: number }

/** Whether another code may be sent, and what to write back. */
export interface RateVerdict {
  allowed: boolean;
  requests: number;
  windowStart: number;
  /** Seconds until the window opens again, when it is closed. */
  retryIn?: number;
}

/** May this address be sent another code? Pure, so the rule is testable. */
export function rateLimit(row: RateRow | null | undefined, now: number): RateVerdict {
  if (!row) return { allowed: true, requests: 1, windowStart: now };
  if (now - row.window_start > RATE_WINDOW_MS) {
    return { allowed: true, requests: 1, windowStart: now };
  }
  if (row.requests >= MAX_REQUESTS_PER_WINDOW) {
    const retryIn = Math.ceil((row.window_start + RATE_WINDOW_MS - now) / 1000);
    return { allowed: false, retryIn, requests: row.requests, windowStart: row.window_start };
  }
  return { allowed: true, requests: row.requests + 1, windowStart: row.window_start };
}

/** A code as the table holds it. */
export interface CodeRow {
  code_hash: string;
  expires: number;
  attempts: number;
}

/** What to do about an attempt: let them in, or say why not — and whether to
 *  destroy the code and whether this attempt counts against the allowance. */
export interface CodeVerdict {
  ok: boolean;
  reason?: string;
  destroy?: boolean;
  countAttempt?: boolean;
}

/** Decide the outcome of a verification attempt. Pure; the caller does the I/O. */
export function checkCode(
  row: CodeRow | null | undefined, suppliedHash: string, now: number,
): CodeVerdict {
  if (!row) return { ok: false, reason: 'no code has been requested for that address' };
  if (row.expires < now) return { ok: false, reason: 'that code has expired', destroy: true };
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'too many attempts; request a new code', destroy: true };
  }
  if (!constantTimeEqual(row.code_hash, suppliedHash)) {
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    return {
      ok: false,
      reason: left > 0 ? `that code is not right (${left} attempts left)`
        : 'too many attempts; request a new code',
      destroy: left <= 0,
      countAttempt: true,
    };
  }
  return { ok: true, destroy: true };
}
