import { sveltekit } from '@sveltejs/kit/vite';

/* In production one Worker serves both the app and the API on one origin. The
 * Vite dev server only serves the app, so every /v1 call would 404 — which is
 * exactly what a passkey sign-in looks like when it fails here. The proxy sends
 * those calls to a local `wrangler dev`, so development matches production.
 *
 * Run both with `npm run dev` from this directory.
 */
const API = process.env.FRCOG_API_ORIGIN || 'http://127.0.0.1:8787';

export default {
  plugins: [sveltekit()],
  server: {
    fs: { allow: ['..'] },
    /* static/media is a symlink to ~8,000 audio files. Watching them exhausts
       the system's inotify limit and Vite dies with ENOSPC before it serves
       anything. They never change during development. */
    watch: { ignored: ['**/static/media/**', '**/data/**'] },
    proxy: {
      '/v1': { target: API, changeOrigin: false },
      '/media': { target: API, changeOrigin: false },
    },
  },
};
