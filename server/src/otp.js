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

export const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

/** Rejects the obviously malformed. Real validation is delivery: a typo means
 *  the code never arrives. */
export function looksLikeEmail(email) {
  const e = normaliseEmail(email);
  return e.length >= 6 && e.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(e);
}

/** Uniform over 000000-999999. Rejection sampling rather than a modulo, which
 *  would make some codes likelier than others. */
export function generateCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const limit = 4294967295 - (4294967296 % 1000000);
  for (;;) {
    const b = random(4);
    const value = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
    if (value <= limit) return String(value % 1000000).padStart(6, '0');
  }
}

export async function hashCode(email, code, pepper = '') {
  const data = new TextEncoder().encode(`${normaliseEmail(email)}:${code}:${pepper}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent comparison, so a mismatch cannot be timed. */
export function constantTimeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** May this address be sent another code? Pure, so the rule is testable. */
export function rateLimit(row, now) {
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

/** Decide the outcome of a verification attempt. Pure; the caller does the I/O. */
export function checkCode(row, suppliedHash, now) {
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
