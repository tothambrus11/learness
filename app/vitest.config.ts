/** Test runner configuration.
 *
 *  The tests are about rules, not about a browser: scheduling, merging,
 *  grading what was typed, reading the review log. They run in Node, and the
 *  handful that touch IndexedDB bring their own fake through `setup.ts`, so
 *  the suite stays a second long and needs no browser to be installed.
 *
 *  `$lib` is resolved here rather than through SvelteKit's plugin: pulling in
 *  the whole SvelteKit pipeline to run a pure function would cost more than
 *  the tests themselves.
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Absolute path to a directory of this project, for an alias. */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      $lib: here('./src/lib'),
      /* SvelteKit's `$app/*` modules exist only inside its build. The few the
         library touches are stubbed, so a module that names one can still be
         tested as a plain function. */
      '$app/paths': here('./tests/stubs/app-paths.ts'),
      '$app/navigation': here('./tests/stubs/app-navigation.ts'),
      '$app/state': here('./tests/stubs/app-state.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    /* A test that needs a fixed clock says so itself; nothing here is allowed
       to drift with the wall clock by accident. */
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.worker.ts', 'src/lib/types.ts'],
    },
  },
});
