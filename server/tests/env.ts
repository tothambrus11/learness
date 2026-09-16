/** The Worker, started fresh: a database with nothing in it, a catalogue of
 *  six words, and an account to hold a token.
 *
 *  The catalogue served is the one the pipeline's own tests export,
 *  tests/fixtures/catalogue/ at the repository root, so the connector is
 *  tested against exactly the shape the pipeline writes — including the
 *  dictionary shards it reads a letter at a time. The database is SQLite
 *  with the migrations applied (see d1.ts). Nothing else is faked: a request
 *  goes through `worker.fetch` as it would on the edge.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import type { Env } from '../src/env.js';
import { ensureAccount, issueToken } from '../src/tokens.js';
import { testDatabase } from './d1.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures', 'catalogue');

/** Where the Worker believes it is deployed; every request in a test names it. */
export const ORIGIN = 'https://learness.test';

/** The built app's files, as the assets binding serves them: the catalogue
 *  under /catalogue, and a 404 for everything else, which is what
 *  `not_found_handling: none` gives the Worker in production. */
function fixtureAssets({ catalogue = true } = {}): Fetcher {
  const assets = {
    fetch: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const name = url.pathname.startsWith('/catalogue/') ? url.pathname.slice('/catalogue/'.length) : '';
      const file = name && catalogue ? join(FIXTURE, name) : '';
      if (!file || name.includes('/') || !existsSync(file)) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(readFileSync(file, 'utf8'), {
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  return assets as unknown as Fetcher;
}

export interface Harness {
  env: Env;
  /** A request to the Worker, by path. `init.json` is sent as a JSON body. */
  fetch(path: string, init?: RequestInit & { json?: unknown; token?: string }): Promise<Response>;
  /** An account and a device token on it, ready to be used. */
  signIn(email?: string, scope?: 'full' | 'words'): Promise<{ token: string; userId: string }>;
}

export function harness({ catalogue = true }: { catalogue?: boolean } = {}): Harness {
  const { d1 } = testDatabase();
  const env: Env = {
    DB: d1, ASSETS: fixtureAssets({ catalogue }), ALLOWED_ORIGIN: ORIGIN, EMAIL_PROVIDER: 'off',
  };
  return {
    env,
    async fetch(path, init = {}) {
      const { json, token, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (json !== undefined) headers.set('content-type', 'application/json');
      if (token) headers.set('authorization', `Bearer ${token}`);
      const body = json !== undefined ? JSON.stringify(json) : rest.body ?? null;
      return worker.fetch(new Request(`${ORIGIN}${path}`, { ...rest, headers, body }), env);
    },
    async signIn(email = 'learner@example.com', scope = 'full') {
      const userId = await ensureAccount(env, email);
      const { token } = await issueToken(env, userId, 'test phone', scope);
      return { token, userId };
    },
  };
}
