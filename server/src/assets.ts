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
