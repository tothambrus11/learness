import adapter from '@sveltejs/adapter-static';

/** Static single-page app: no server anywhere, so it can be hosted on any
 *  HTTPS static host and installed on a phone for offline use. */
export default {
  kit: {
    adapter: adapter({ fallback: 'index.html', precompress: false, strict: false }),
    serviceWorker: {
      register: true,
      /* Audio is cached as it is played, not shipped in the install: there are
         ten thousand clips. Everything else in static/ is small and precached. */
      files: (file) => !file.startsWith('media/') && !file.startsWith('ort/'),
    },
  },
};
