import { defineConfig } from 'vitest/config';

/** The sync API's own tests: the rules that decide a login, run as plain
 *  functions. What needs D1 and workerd is covered by the app's end-to-end
 *  suite and by deploying. */
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
