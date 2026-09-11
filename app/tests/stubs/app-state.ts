/** SvelteKit's `$app/state`, for tests.
 *
 *  Only the current URL is ever read, and only by screens. A fixed root URL is
 *  enough for a module to be imported; a test that cares sets `page.url`.
 */

/** The page the app believes it is on. Writable, so a test can place it. */
export const page = {
  url: new URL('http://localhost/'),
};
