/** SvelteKit's options for every route in the app. */

/** No server-side render: the page is built from IndexedDB, which exists only
 *  in the browser. */
export const ssr = false;

/** Every route is baked out at build time as a static shell. */
export const prerender = true;

/** Routes always end in a slash, so `/study` and `/study/` are one URL. The
 *  static host serves `study/index.html` for it, and `base + '/study/'` built
 *  by hand anywhere in the app matches what the router expects. */
export const trailingSlash = 'always';
