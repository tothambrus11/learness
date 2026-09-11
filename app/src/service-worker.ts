/// <reference types="@sveltejs/kit" />
/** Offline: what the app keeps, and what it still goes to the network for. */

import { base, build, files, prerendered, version } from '$service-worker';

/* A service worker's `self` has clients, a skip-waiting and typed events, none
   of which the DOM's window-shaped `self` admits to. */
/** This file's own global. */
const sw = self as unknown as ServiceWorkerGlobalScope;

/** The cache for this release: code, pages and catalogue. Named after the
 *  version, so activating a new one leaves the old behind to be deleted. */
const SHELL = `shell-${version}`;
/** The cache every clip that has been played is kept in. */
const MEDIA = 'media'; // outlives releases: a clip never changes
/** The cache the on-device voice's weights are in, by the name tts/cache.ts
 *  gives them. Never cleared on an update, or every release would fetch the
 *  hundreds of megabytes again. */
const VOICE = 'supertonic-3';
/* Vite emits a copy of the ONNX Runtime WebAssembly beside the voice's worker,
   21 MB the app never loads: it reads the runtime from /ort/ instead. */
/** Everything fetched at install time, so the app runs offline from the first
 *  session after it. WebAssembly built beside the code is left out. */
const PRECACHE = [...build.filter((f) => !f.endsWith('.wasm')), ...files, ...prerendered];
/** The single page every unknown route falls back to, which is what the server
 *  does too. */
const FALLBACK = `${base}/`;

/** True for the sync API, which is never answered from a cache: what it
 *  carries has to reach the server or fail visibly. */
const isSyncApi = (url: URL): boolean => url.pathname.startsWith(`${base}/v1/`);

/** True for anything big that never changes — the clips, and the on-device
 *  voice's WebAssembly runtime — each of which is kept from its first fetch. */
const isImmutableAsset = (url: URL): boolean =>
  url.pathname.startsWith(`${base}/media/`) || url.pathname.startsWith(`${base}/ort/`);

/** True for a hashed build file, which never changes under its name and so is
 *  safe to keep the first time it loads — the voice's worker and the chunks it
 *  pulls in, so a feature used once online is there offline too. */
const isHashedBuildFile = (url: string): boolean =>
  new URL(url).pathname.startsWith(`${base}/_app/immutable/`);

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

sw.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (isSyncApi(url)) return;

  if (isImmutableAsset(url)) {
    event.respondWith(mediaFirst(request));
  } else if (url.pathname.startsWith(`${base}/catalogue/`)) {
    event.respondWith(freshFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(page(request));
  } else {
    event.respondWith(shellFirst(request));
  }
});

/** The shell cache where it has the request, else the network — and a hashed
 *  build file fetched that way is kept. */
async function shellFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request, { cacheName: SHELL });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && isHashedBuildFile(request.url)) {
    const shell = await caches.open(SHELL);
    void shell.put(request, res.clone());
  }
  return res;
}

/** The network first, with what it answers kept for offline; the stored copy
 *  answers when the fetch fails. */
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

/** A navigation: the prerendered page for the route, else the network, else the
 *  single-page fallback. */
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

/** A clip from the media cache, fetched and kept whole the first time, with the
 *  range the element asked for cut from it. A clip that cannot be stored is
 *  passed straight through instead. */
async function mediaFirst(request: Request): Promise<Response> {
  /* The cache refuses to store a partial response, so the whole clip is kept
     and the element's byte range is cut from it here. */
  const media = await caches.open(MEDIA);
  const key = request.url;
  let full = await media.match(key);
  if (!full) {
    /* Bypassing the HTTP cache: once a clip has been range-loaded outside this
       worker Firefox answers a plain fetch with a 206, and Cache.put wants 200. */
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
