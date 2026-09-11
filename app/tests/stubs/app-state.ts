/** SvelteKit's `$app/state`, for tests. Carries a fixed root URL until a test
 *  sets `page.url` itself: the URL is all that is ever read of it, and only by
 *  screens, so a fixed one is enough for a module to be imported. */

/** The page the app believes it is on. Writable, so a test can place it. */
export const page = {
  url: new URL('http://localhost/'),
};
