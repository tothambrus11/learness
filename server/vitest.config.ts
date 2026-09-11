/** Test runner configuration.
 *
 *  What is tested here is rules, not plumbing: the one-time-code arithmetic —
 *  how a code is drawn, how it is hashed, how many tries and how many requests
 *  an address gets. Those are pure functions, so they run in Node with no
 *  Worker runtime, no D1 and no network, and the suite stays instant.
 *
 *  The handlers that need a real Worker are not covered here on purpose:
 *  standing one up would cost more than it would prove for code that is mostly
 *  SQL.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
