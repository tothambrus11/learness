import { sveltekit } from '@sveltejs/kit/vite';

/* In production one Worker serves both the app and the API on one origin. The
 * Vite dev server only serves the app, so every /v1 call would 404 — which is
 * exactly what a passkey sign-in looks like when it fails here. The proxy sends
 * those calls to a local `wrangler dev`, so development matches production.
 *
 * Run both with `npm run dev` from this directory, or `npm run dev:prod` to
 * point the same proxy at the live deployment.
 */
const API = process.env.FRCOG_API_ORIGIN || 'http://127.0.0.1:8787';
/* The Host header must name the target when that is a real domain: Cloudflare
   routes on it, and "localhost:5173" reaches nothing. Harmless for the local
   Worker. */
const changeOrigin = true;

export default {
  plugins: [sveltekit()],
  /* The voice runs in a module worker and ONNX Runtime loads its WebAssembly
     backend with a dynamic import, which only the ES worker format allows. */
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: {
    fs: { allow: ['..'] },
    /* static/media is a symlink to ~8,000 audio files. Watching them exhausts
       the system's inotify limit and Vite dies with ENOSPC before it serves
       anything. They never change during development. */
    watch: { ignored: ['**/static/media/**', '**/data/**'] },
    proxy: {
      '/v1': { target: API, changeOrigin },
      '/media': { target: API, changeOrigin },
    },
  },
};
