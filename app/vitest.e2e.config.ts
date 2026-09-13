import { defineConfig } from 'vitest/config';

/** The browser suite, run on its own by `npm run test:e2e`.
 *
 *  It needs the app built and a Chromium to drive, so it is not part of the
 *  unit run: those must stay fast enough to be run on every save. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.ts'],
    /* A browser start, a build's worth of modules and an IndexedDB upgrade all
       happen once per file. */
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
