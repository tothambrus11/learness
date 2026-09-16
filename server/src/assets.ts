/** What the single-page fallback is for, and what it is not for.
 *
 *  Every route of the app is a path with no file in it — "/", "/study/",
 *  "/words/" — and any of them may be asked for directly, so a path the asset
 *  store does not have is answered with index.html and the app routes it
 *  itself. That is right for pages and wrong for everything else, and it used
 *  to be done for everything: a recording the catalogue had been rebuilt
 *  without came back as 200 with the app's own HTML in it, and the browser
 *  said "Content-Type text/html is not supported. No decoders for requested
 *  formats" into the console while the button on screen did nothing at all.
 *  A missing file is a 404 — which the service worker, the warm-up and the
 *  card can all see.
 */

/** Directories that hold files, whatever the name inside them looks like. */
const FILES = ['/media/', '/catalogue/', '/ort/', '/_app/'];

/** Is this path one of the app's pages, rather than a file it loads?
 *
 *  A page is a path with no extension on its last segment and not under a
 *  directory of files. "/study/" is a page; "/media/frcog-5293.mp3" is not,
 *  and neither is "/favicon.ico".
 */
export function isPagePath(pathname: string): boolean {
  const path = pathname || '/';
  if (FILES.some((dir) => path.startsWith(dir))) return false;
  const last = path.slice(path.lastIndexOf('/') + 1);
  return !/\.[A-Za-z0-9]+$/.test(last);
}

/** The two headers that make a page cross-origin isolated, which is what
 *  lets the on-device voice run its WebAssembly on more than one thread:
 *  `SharedArrayBuffer` exists only on an isolated page, and without it ONNX
 *  Runtime is single-threaded however many cores the phone has. Measured on
 *  the app's own model, one worker with four threads halves a clip's latency
 *  (5.3 s to 2.6 s, faster than the speech it makes) at no memory cost; an
 *  extra worker costs a gigabyte and shortens nothing (#54).
 *
 *  `require-corp` rather than `credentialless`, checked against everything
 *  the app loads from another origin — which is the voice's weights, and
 *  only them. They are fetched in CORS mode, and every hop authorises it:
 *  huggingface.co reflects the origin on its redirects, and the CDN it sends
 *  the bytes from answers `*`; neither sends Cross-Origin-Resource-Policy,
 *  which a CORS response does not need. Everything else — the code, the
 *  catalogue, the recordings, the runtime under /ort/, the sync API — is on
 *  this origin. `credentialless` would forgive a cross-origin `<img>` or
 *  `<audio>` added later without CORS, but Safari has never shipped it, and a
 *  phone is exactly where the extra cores are wanted. So the strict mode: a
 *  cross-origin resource the app one day loads without CORS is blocked, and
 *  the browser says why; the answer is `crossorigin` on the tag, not a
 *  looser policy here.
 *
 *  A document's policy, not a file's: the code, the clips and the runtime
 *  need nothing, being same-origin, and a Cross-Origin-Resource-Policy on
 *  every file would have stopped the icon from being drawn where a connector
 *  draws it (#50). `same-origin` on the opener side severs a popup from the
 *  page that opened it, which nothing here relies on: the report links are
 *  `noopener` already, and passkeys and the OAuth flow are top-level
 *  navigations.
 */
export const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
} as const;

/** The response as the browser should see it: a page carrying `ISOLATION`,
 *  anything else exactly as it was. Decided by the content type rather than
 *  the path, because the single-page fallback hands index.html out under a
 *  route's own name, and that page must be isolated too. */
export function isolated(res: Response): Response {
  if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(ISOLATION)) headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
