/** SvelteKit's `$app/paths`, for tests: the real module is generated inside a
 *  SvelteKit build. Only `base` is read by the library, and only to build a URL,
 *  so the empty strings the app itself is deployed with are the whole stub. */

/** The path the app is served under. Empty: this app owns its origin. */
export const base = '';

/** The absolute URL of the deployment, unused by the library and empty here. */
export const assets = '';
