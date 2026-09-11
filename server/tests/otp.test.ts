/** The one-time-code rules, which are pure and so are tested without a
 *  database: the draw, the hash, the rate limit, and what a verification
 *  attempt should do. */
import { describe, expect, test } from 'vitest';

import type { CodeRow, RateLimitRow } from '../src/otp';
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_REQUESTS_PER_WINDOW,
  RATE_WINDOW_MS,
  checkCode,
  constantTimeEqual,
  generateCode,
  hashCode,
  looksLikeEmail,
  normaliseEmail,
  rateLimit,
} from '../src/otp';

test('codes are six digits and uniformly distributed', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 3000; i++) {
    const c = generateCode();
    expect(c).toMatch(/^\d{6}$/);
    seen.add(c);
  }
  expect(seen.size, 'codes should not repeat much').toBeGreaterThan(2800);
  /* Rejection sampling, not a modulo: the low and high halves should be even. */
  let low = 0;
  for (const c of seen) if (Number(c) < 500000) low++;
  const ratio = low / seen.size;
  expect(ratio > 0.45 && ratio < 0.55, `skewed distribution: ${ratio.toFixed(3)}`).toBe(true);
});

test('leading zeros are preserved', () => {
  const bytes = [0, 0, 0, 7];
  expect(generateCode(() => Uint8Array.from(bytes))).toBe('000007');
});

test('the hash binds the code to the address', async () => {
  const a = await hashCode('alice@example.com', '123456');
  const b = await hashCode('bob@example.com', '123456');
  expect(a, 'the same code for a different address must not match').not.toBe(b);
  expect(a).toBe(await hashCode('  Alice@Example.COM ', '123456'));
});

test('a pepper changes the hash', async () => {
  expect(await hashCode('a@b.co', '123456', '')).not.toBe(
    await hashCode('a@b.co', '123456', 'secret'),
  );
});

test('comparison does not leak length', () => {
  expect(constantTimeEqual('abc', 'abc')).toBe(true);
  expect(constantTimeEqual('abc', 'abd')).toBe(false);
  expect(constantTimeEqual('abc', 'abcdef')).toBe(false);
  expect(constantTimeEqual('', 'a')).toBe(false);
});

test('obvious nonsense is rejected before an email is sent', () => {
  expect(looksLikeEmail('a@b.co')).toBe(true);
  expect(looksLikeEmail(' User@Example.ORG ')).toBe(true);
  for (const bad of ['', 'no-at-sign', 'a@b', 'a b@c.co', '@b.co', 'a@.co']) {
    expect(looksLikeEmail(bad), `${bad} should be rejected`).toBe(false);
  }
});

test('normalising is case and whitespace insensitive', () => {
  expect(normaliseEmail('  A@B.CO ')).toBe('a@b.co');
});

describe('rate limiting', () => {
  test('a first request is allowed', () => {
    const r = rateLimit(null, 1000);
    expect(r.allowed).toBe(true);
    expect(r.requests).toBe(1);
  });

  test('requests are capped within the window', () => {
    const now = 1_000_000;
    let row: RateLimitRow = { requests: 1, window_start: now };
    for (let i = 2; i <= MAX_REQUESTS_PER_WINDOW; i++) {
      const r = rateLimit(row, now + 1000);
      expect(r.allowed, `request ${i} should be allowed`).toBe(true);
      row = { requests: r.requests, window_start: r.windowStart };
    }
    const blocked = rateLimit(row, now + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryIn).toBeGreaterThan(0);
  });

  test('the window resets', () => {
    const now = 1_000_000;
    const row: RateLimitRow = { requests: MAX_REQUESTS_PER_WINDOW, window_start: now };
    const after = rateLimit(row, now + RATE_WINDOW_MS + 1);
    expect(after.allowed).toBe(true);
    expect(after.requests).toBe(1);
  });
});

describe('verification', () => {
  /** The moment every attempt below is made at, in milliseconds. */
  const now = 5_000_000;

  /** A row holding a live code whose hash is `'HASH'`, with whatever a case
   *  wants written over it. */
  const live = (over: Partial<CodeRow> = {}): CodeRow => ({
    code_hash: 'HASH',
    expires: now + CODE_TTL_MS,
    attempts: 0,
    ...over,
  });

  test('the right code succeeds once and destroys itself', () => {
    const v = checkCode(live(), 'HASH', now);
    expect(v.ok).toBe(true);
    expect(v.destroy, 'a code must not be reusable').toBe(true);
  });

  test('a wrong code counts an attempt and says how many are left', () => {
    const v = checkCode(live(), 'WRONG', now);
    expect(v.ok).toBe(false);
    expect(v.countAttempt).toBe(true);
    expect(v.destroy).toBe(false);
    expect(v.reason).toMatch(/4 attempts left/);
  });

  test('the code is destroyed after too many attempts', () => {
    const v = checkCode(live({ attempts: MAX_ATTEMPTS - 1 }), 'WRONG', now);
    expect(v.ok).toBe(false);
    expect(v.destroy, 'guessing must not be allowed to continue').toBe(true);
  });

  test('an exhausted code is refused even if correct', () => {
    const v = checkCode(live({ attempts: MAX_ATTEMPTS }), 'HASH', now);
    expect(v.ok).toBe(false);
    expect(v.destroy).toBe(true);
  });

  test('an expired code is refused even if correct', () => {
    const v = checkCode(live({ expires: now - 1 }), 'HASH', now);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/expired/);
  });

  test('verifying without ever requesting is refused', () => {
    expect(checkCode(null, 'HASH', now).ok).toBe(false);
  });
});
