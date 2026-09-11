/// <reference types="@sveltejs/kit" />
/** Offline.
 *
 *  Everything the app needs to run a session is fetched once and kept: the
 *  built code, the prerendered pages and the whole catalogue, which is small.
 *  Audio is the exception. There are ten thousand clips and 180 MB of them, so
 *  each is kept the first time it is played rather than fetched up front; after
 *  a few sessions the words you actually meet are all there.
 *
 *  The sync API is never cached. A review sent from a basement must reach the
 *  server or fail visibly, not be answered from a stale copy.
 */
import { base, build, files, prerendered, version } from '$service-worker';

/** This file's own global. A service worker's `self` has clients, a skip-
 *  waiting and typed events, none of which the DOM's window-shaped `self`
 *  admits to; naming it once here beats a cast at every use. */
const sw = self as unknown as ServiceWorkerGlobalScope;

/** The cache for this release: code, pages and catalogue. Named after the
 *  version, so activating a new one leaves the old behind to be deleted. */
const SHELL = `shell-${version}`;
/** The cache every clip that has been played is kept in. */
const MEDIA = 'media'; // outlives releases: a clip never changes
/** The cache the on-device voice's weights are in, by the name tts/cache.ts
 *  gives them.
 *
 *  The voice is hundreds of megabytes fetched once, and a release changes
 *  nothing about it. Kept by name, or every update would fetch it again. The
 *  caches Kokoro used are not on the list, so they are cleared on the update
 *  that drops it. */
const VOICE = 'supertonic-3';
/** Everything fetched at install time, so the app runs offline from the first
 *  session after it.
 *
 *  Bundling the voice's worker makes Vite emit a copy of the ONNX Runtime
 *  WebAssembly beside it, 21 MB the app never loads: it reads the runtime from
 *  /ort/ instead, so that the service worker can keep it. Installing must not
 *  fetch the copy. */
const PRECACHE = [...build.filter((f) => !f.endsWith('.wasm')), ...files, ...prerendered];
/** The single page every unknown route falls back to, which is what the server
 *  does too. */
const FALLBACK = `${base}/`;

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== SHELL && key !== MEDIA && key !== VOICE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

/* The page asks for this once you agree to reload for a new version. */
sw.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith(`${base}/v1/`)) return;

  /* Audio, and the 20 MB WebAssembly runtime of the on-device voice: big,
     never changing, kept from the first fetch. */
  if (url.pathname.startsWith(`${base}/media/`) || url.pathname.startsWith(`${base}/ort/`)) {
    event.respondWith(mediaFirst(request));
  } else if (url.pathname.startsWith(`${base}/catalogue/`)) {
    event.respondWith(freshFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(page(request));
  } else {
    event.respondWith(shellFirst(request));
  }
});

/** Hashed build files not in the install list, such as the on-device voice's
 *  worker and the chunks it pulls in, are kept the first time they load, so
 *  a feature used once online is there offline too. */
async function shellFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request, { cacheName: SHELL });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && new URL(request.url).pathname.startsWith(`${base}/_app/immutable/`)) {
    const shell = await caches.open(SHELL);
    void shell.put(request, res.clone());
  }
  return res;
}

/** The catalogue is content, and content changes without a new release
 *  needing to be adopted: a rebuild that corrects an article or adds a
 *  definition should be on screen at the next load, not after the worker
 *  swap that a "new version" banner waits on. So online it is fetched, and
 *  the copy kept for offline is refreshed; offline, the copy answers. */
async function freshFirst(request: Request): Promise<Response> {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const shell = await caches.open(SHELL);
      void shell.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request, { cacheName: SHELL });
    return cached ?? Response.error();
  }
}

/** Every route is prerendered, and anything else is the single-page fallback,
 *  which is what the server does too. */
async function page(request: Request): Promise<Response> {
  const shell = await caches.open(SHELL);
  const url = new URL(request.url);
  const exact = await shell.match(url.pathname);
  if (exact) return exact;
  try {
    return await fetch(request);
  } catch {
    return (await shell.match(FALLBACK)) ?? Response.error();
  }
}

/** Audio elements ask for byte ranges, and the cache refuses to store a partial
 *  response, so the whole clip is fetched and kept, and ranges are cut from it
 *  here. Clips are a few seconds long, so slicing in memory is nothing.
 *
 *  The fill bypasses the browser's HTTP cache: once a clip has been range-loaded
 *  outside this worker, Firefox answers a plain fetch of it out of the partial
 *  entry with a 206, and Cache.put rejects anything but a 200. Should the fill
 *  still come back short, or refuse to store, the element's own request goes
 *  straight through: the clip plays, it just is not kept for offline. */
async function mediaFirst(request: Request): Promise<Response> {
  const media = await caches.open(MEDIA);
  const key = request.url;
  let full = await media.match(key);
  if (!full) {
    full = await fetch(key, { cache: 'no-store' });
    if (full.status !== 200) return fetch(request);
    try {
      await media.put(key, full.clone());
    } catch {
      return fetch(request);
    }
  }
  return slice(request, full);
}

/** The part of a stored clip the element asked for, as a 206, or the whole of
 *  it where no range was asked for. A range that makes no sense against the
 *  clip's real length is a 416 rather than a guess. */
async function slice(request: Request, full: Response): Promise<Response> {
  const header = request.headers.get('range');
  if (!header) return full;
  const buf = await full.arrayBuffer();
  const size = buf.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  let start = 0;
  let end = size - 1;
  if (m && m[1] === '' && m[2] !== '') start = Math.max(0, size - Number(m[2]));
  else if (m && m[1] !== '') {
    start = Number(m[1]);
    if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
  }
  if (!m || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }
  const headers = new Headers(full.headers);
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(buf.slice(start, end + 1), { status: 206, headers });
}
