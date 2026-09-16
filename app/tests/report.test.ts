/** The bug report's surroundings, gathered from the modules that know them.
 *
 *  What the report carries is diagnostics.test.ts's business; this is about
 *  what report.ts finds out for it.
 */
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { freshApp } from './harness.js';

test('a bug report says which screen it was sent from', async () => {
  /* "The button did nothing" arrived with the notes and the build and no way
     to tell which screen the button was on (#47). */
  await freshApp();
  vi.stubGlobal('location', {
    origin: 'https://learness.example', pathname: '/word/', search: '?k=bug%7Cnoun',
  });
  try {
    const { environment, issueUrl, screenOf } = await import('../src/lib/report.js');
    const env = await environment();
    assert.equal(env.page, '/word/?k=bug%7Cnoun', 'the path and the query: the word is named');
    const body = decodeURIComponent(issueUrl(env));
    assert.ok(body.includes(' · on /word/?k=bug%7Cnoun'), body);
    assert.equal(body.includes('learness.example'), false,
      'never the origin: a report from a test deployment reads like any other');

    assert.equal(screenOf({ pathname: '/', search: '' }), '/');
    assert.equal(screenOf({ pathname: '/', search: '?token=abc' }), '/',
      'a token in an address would be a token in a public issue');
    assert.equal(
      screenOf({ pathname: '/connect/',
        search: '?client_id=claude&redirect_uri=https://a/b&code_challenge=x&state=y' }),
      '/connect/?client_id=claude&redirect_uri=https%3A%2F%2Fa%2Fb',
      'the connect screen keeps who is asking and drops the secrets of the asking');
  } finally {
    vi.unstubAllGlobals();
  }
});
