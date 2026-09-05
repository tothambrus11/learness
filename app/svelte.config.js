import adapter from '@sveltejs/adapter-static';

/** Static single-page app: no server anywhere, so it can be hosted on any
 *  HTTPS static host and installed on a phone for offline use. */
export default {
  kit: {
    adapter: adapter({ fallback: 'index.html', precompress: false, strict: false }),
    serviceWorker: { register: true },
  },
};
