import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_TTL_MS, MAX_ATTEMPTS, MAX_REQUESTS_PER_WINDOW, RATE_WINDOW_MS,
  checkCode, constantTimeEqual, generateCode, hashCode, looksLikeEmail, normaliseEmail, rateLimit,
} from '../src/otp.js';

test('codes are six digits and uniformly distributed', () => {
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    const c = generateCode();
    assert.match(c, /^\d{6}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 2800, 'codes should not repeat much');
  /* Rejection sampling, not a modulo: the low and high halves should be even. */
  let low = 0;
  for (const c of seen) if (Number(c) < 500000) low++;
  const ratio = low / seen.size;
  assert.ok(ratio > 0.45 && ratio < 0.55, `skewed distribution: ${ratio.toFixed(3)}`);
});

test('leading zeros are preserved', () => {
  const bytes = [0, 0, 0, 7];
  assert.equal(generateCode(() => Uint8Array.from(bytes)), '000007');
});

test('the hash binds the code to the address', async () => {
  const a = await hashCode('alice@example.com', '123456');
  const b = await hashCode('bob@example.com', '123456');
  assert.notEqual(a, b, 'the same code for a different address must not match');
  assert.equal(a, await hashCode('  Alice@Example.COM ', '123456'));
});

test('a pepper changes the hash', async () => {
  assert.notEqual(
    await hashCode('a@b.co', '123456', ''),
    await hashCode('a@b.co', '123456', 'secret'));
});

test('comparison does not leak length', () => {
  assert.ok(constantTimeEqual('abc', 'abc'));
  assert.ok(!constantTimeEqual('abc', 'abd'));
  assert.ok(!constantTimeEqual('abc', 'abcdef'));
  assert.ok(!constantTimeEqual('', 'a'));
});

test('obvious nonsense is rejected before an email is sent', () => {
  assert.ok(looksLikeEmail('a@b.co'));
  assert.ok(looksLikeEmail(' User@Example.ORG '));
  for (const bad of ['', 'no-at-sign', 'a@b', 'a b@c.co', '@b.co', 'a@.co']) {
    assert.ok(!looksLikeEmail(bad), `${bad} should be rejected`);
  }
});

test('normalising is case and whitespace insensitive', () => {
  assert.equal(normaliseEmail('  A@B.CO '), 'a@b.co');
});

// --- rate limiting ---

test('a first request is allowed', () => {
  const r = rateLimit(null, 1000);
  assert.equal(r.allowed, true);
  assert.equal(r.requests, 1);
});

test('requests are capped within the window', () => {
  const now = 1_000_000;
  let row = { requests: 1, window_start: now };
  for (let i = 2; i <= MAX_REQUESTS_PER_WINDOW; i++) {
    const r = rateLimit(row, now + 1000);
    assert.equal(r.allowed, true, `request ${i} should be allowed`);
    row = { requests: r.requests, window_start: r.windowStart };
  }
  const blocked = rateLimit(row, now + 1000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryIn > 0);
});

test('the window resets', () => {
  const now = 1_000_000;
  const row = { requests: MAX_REQUESTS_PER_WINDOW, window_start: now };
  const after = rateLimit(row, now + RATE_WINDOW_MS + 1);
  assert.equal(after.allowed, true);
  assert.equal(after.requests, 1);
});

// --- verification ---

const now = 5_000_000;
const live = (over = {}) => ({ code_hash: 'HASH', expires: now + CODE_TTL_MS, attempts: 0, ...over });

test('the right code succeeds once and destroys itself', () => {
  const v = checkCode(live(), 'HASH', now);
  assert.equal(v.ok, true);
  assert.equal(v.destroy, true, 'a code must not be reusable');
});

test('a wrong code counts an attempt and says how many are left', () => {
  const v = checkCode(live(), 'WRONG', now);
  assert.equal(v.ok, false);
  assert.equal(v.countAttempt, true);
  assert.equal(v.destroy, false);
  assert.match(v.reason, /4 attempts left/);
});

test('the code is destroyed after too many attempts', () => {
  const v = checkCode(live({ attempts: MAX_ATTEMPTS - 1 }), 'WRONG', now);
  assert.equal(v.ok, false);
  assert.equal(v.destroy, true, 'guessing must not be allowed to continue');
});

test('an exhausted code is refused even if correct', () => {
  const v = checkCode(live({ attempts: MAX_ATTEMPTS }), 'HASH', now);
  assert.equal(v.ok, false);
  assert.equal(v.destroy, true);
});

test('an expired code is refused even if correct', () => {
  const v = checkCode(live({ expires: now - 1 }), 'HASH', now);
  assert.equal(v.ok, false);
  assert.match(v.reason, /expired/);
});

test('verifying without ever requesting is refused', () => {
  assert.equal(checkCode(null, 'HASH', now).ok, false);
});
