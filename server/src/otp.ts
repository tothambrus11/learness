/** Email one-time codes: issuing them, hashing them, and the rules that decide
 *  whether one may be sent and whether one may be spent. */

/* A six-digit code is only a million possibilities, so hashing it in the
   database is not what makes this safe. The protections that matter are the
   short life, the small number of attempts before the code is destroyed, and
   the limit on how often one address can ask for a new one. Hashing is there so
   that reading the table does not show live codes. */

/* Short enough that a code read off an old email is useless, long enough to go
   and find the email. */
/** How long a code is good for, in milliseconds. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/* Which is what keeps a million possibilities out of reach of a script. */
/** Wrong guesses a code survives; the next one destroys it. */
export const MAX_ATTEMPTS = 5;

/** The span the request limit is counted over, in milliseconds. */
export const RATE_WINDOW_MS = 15 * 60 * 1000;

/** Codes one address may ask for inside a window, before it is told to wait. */
export const MAX_REQUESTS_PER_WINDOW = 3;

/* A body that sent something other than a string for its address is a client
   bug, not an address. */
/** The address as it is stored and hashed: trimmed and lower-cased, so that one
 *  person's different spellings land on the same row and the same code.
 *  Anything that is not a string is the empty string, which `looksLikeEmail()`
 *  then refuses. */
export const normaliseEmail = (email: unknown): string =>
  (typeof email === 'string' ? email : '').trim().toLowerCase();

/** True when the normalised address is 6 to 254 characters long and shaped
 *  `something@something.something`. */
export function looksLikeEmail(email: unknown): boolean {
  /* Only the obviously malformed is rejected. Real validation is delivery: a
     typo means the code never arrives. */
  const e = normaliseEmail(email);
  return e.length >= 6 && e.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(e);
}

/** A six-digit code, uniform over 000000-999999, leading zeros kept.
 *
 *  @param random the source of four bytes, which must return at least four.
 *                Defaults to the platform's generator.
 */
export function generateCode(
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  /* Rejection sampling rather than a modulo, which would make some codes
     likelier than others. `random` is injected only so that the distribution
     and the leading-zero padding can be tested against a fixed draw. */
  const limit = 4294967295 - (4294967296 % 1000000);
  for (;;) {
    const b = random(4);
    const value = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
    if (value <= limit) return String(value % 1000000).padStart(6, '0');
  }
}

/** The stored form of a code: SHA-256 of the normalised address, the code and
 *  the pepper, hex. An unset pepper is the empty string. */
export async function hashCode(email: unknown, code: string, pepper = ''): Promise<string> {
  /* Binding the address into the digest is what stops one live code being tried
     against every account, and the pepper is what stops a stolen table being
     turned back into live codes by hashing all million of them. */
  const data = new TextEncoder().encode(`${normaliseEmail(email)}:${code}:${pepper}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when the two strings are equal, in a time that neither their lengths
 *  nor the position of their first difference changes. */
export function constantTimeEqual(a: string, b: string): boolean {
  /* Both sides are hex digests, never user input. The loop runs to the longer
     of the two and folds the length difference in, so a mismatch cannot be
     timed. */
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** The `login_codes` columns the rate limit reads: how many codes this address
 *  has asked for, and when the window it asked in started. */
export interface RateLimitRow {
  /** Codes asked for so far inside the current window. */
  requests: number;
  /** Milliseconds at the first request of the current window. */
  window_start: number;
}

/* The caller writes the two back verbatim, so the window only ever moves
   here. */
/** The rate limit's answer, and the two values the caller must store back.
 *  `requests` and `windowStart` are what the row should now hold, not what it
 *  held. */
export type RateLimitVerdict =
  | {
      /** Send a code. */
      allowed: true;
      /** The request count to store, this request included. */
      requests: number;
      /** The window start to store: unchanged inside a window, now when the
       *  window has rolled over. */
      windowStart: number;
      /** Absent while allowed; there is nothing to wait for. */
      retryIn?: never;
    }
  | {
      /** Refuse: this address has had its three codes. */
      allowed: false;
      /** Seconds until the window ends and a code may be asked for again. */
      retryIn: number;
      /** The stored count, unchanged — a refused request does not count. */
      requests: number;
      /** The stored window start, unchanged. */
      windowStart: number;
    };

/** May this address be sent another code at `now` milliseconds? A null row is
 *  an address that has never asked. Pure; the caller does the I/O. */
export function rateLimit(row: RateLimitRow | null, now: number): RateLimitVerdict {
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

/** The `login_codes` columns a verification reads. */
export interface CodeRow {
  /** The hash the supplied code is compared against, from `hashCode()`. */
  code_hash: string;
  /** Milliseconds after which the code is dead, however right it is. */
  expires: number;
  /** Wrong guesses so far. At `MAX_ATTEMPTS` the code is destroyed. */
  attempts: number;
}

/* A verdict acted on in the wrong order — telling the caller before deleting
   the row — would leave a used code live, which is why both flags are decided
   here and the I/O is the caller's. */
/** What a verification attempt should do: whether it succeeded, what to tell
 *  the caller, and the two writes the caller owes the database afterwards.
 *  `destroy` and `countAttempt` are instructions, not observations. */
export type CodeVerdict =
  | {
      /** The code was right. */
      ok: true;
      /** Always true: a code is single use, so success destroys it. */
      destroy: true;
      /** Absent on success; there is nothing to report. */
      reason?: never;
      /** Absent on success; a right answer is not an attempt to count. */
      countAttempt?: never;
    }
  | {
      /** The code was wrong, expired, exhausted, or never issued. */
      ok: false;
      /* A person mistyping a code needs to know how many tries are left, and an
         attacker has already been capped by the counter. */
      /** What to tell the caller, deliberately plain. Says how many attempts
       *  are left while any remain. */
      reason: string;
      /** Delete the row: the code is spent, expired, or has been guessed at too
       *  often to be worth keeping alive. */
      destroy?: boolean;
      /** Add one to `attempts`. Only a wrong code counts; an expired or
       *  exhausted one is already being destroyed. */
      countAttempt?: boolean;
    };

/** The outcome of one verification attempt at `now` milliseconds, comparing
 *  `suppliedHash` against the row. A null row is an address that has never
 *  asked for a code. Pure; the caller does the I/O. */
export function checkCode(row: CodeRow | null, suppliedHash: string, now: number): CodeVerdict {
  if (!row) return { ok: false, reason: 'no code has been requested for that address' };
  if (row.expires < now) return { ok: false, reason: 'that code has expired', destroy: true };
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'too many attempts; request a new code', destroy: true };
  }
  if (!constantTimeEqual(row.code_hash, suppliedHash)) {
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    return {
      ok: false,
      reason:
        left > 0
          ? `that code is not right (${left} attempts left)`
          : 'too many attempts; request a new code',
      destroy: left <= 0,
      countAttempt: true,
    };
  }
  return { ok: true, destroy: true };
}
