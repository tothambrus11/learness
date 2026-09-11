/** SvelteKit's options for every route in the app. */

/* Everything runs in the browser: the whole point is that it works with no
   network and no server. */

/* The page is built from IndexedDB, which exists only in the browser, so
   rendering it anywhere else would produce an empty shell that then had to be
   thrown away. */
/** No server-side render. */
export const ssr = false;

/* There is no data to bake in — the shell boots and reads the device — so
   prerendering costs nothing and gives the service worker something to
   precache. */
/** Every route is baked out at build time as a static shell. */
export const prerender = true;

/** Routes always end in a slash, so `/study` and `/study/` are one URL. The
 *  static host serves `study/index.html` for it, and `base + '/study/'` built
 *  by hand anywhere in the app matches what the router expects. */
export const trailingSlash = 'always';
