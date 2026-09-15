import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** The app's tests, run against the real modules.
 *
 *  Nothing is mocked that can be run for real: the database tests drive an
 *  actual IndexedDB (fake-indexeddb is a complete implementation, not a stub),
 *  and the session tests build sessions out of it. What is stubbed is what
 *  only SvelteKit can provide — the base path, the navigation — and those
 *  stubs are three lines each, in tests/stubs/.
 */
export default defineConfig({
  plugins: [svelte({ compilerOptions: { runes: true } })],
  resolve: {
    alias: {
      $lib: here('./src/lib'),
      '$app/paths': here('./tests/stubs/app-paths.ts'),
      '$app/navigation': here('./tests/stubs/app-navigation.ts'),
      '$app/state': here('./tests/stubs/app-state.ts'),
      '$app/environment': here('./tests/stubs/app-environment.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /* The end-to-end suite drives a real browser and is run on its own, by
       `npm run test:e2e`: it needs a build and a server, which the unit tests
       must not wait for. */
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
