/** The built app, served the way the Worker serves it in production.
 *
 *  The catalogue is content the pipeline builds, and is not in the repository,
 *  so the end-to-end suite serves the one the pipeline's own tests export:
 *  tests/fixtures/catalogue/ at the repository root, six words, checked in
 *  and compared against a fresh export by tests/test_webexport.py. The
 *  browser therefore runs on exactly the shape the pipeline writes. Two that
 *  read as English and three that do not, so a sitting has both entry rungs;
 *  a verb with a table; and one whose recording is gone, for the card that
 *  has to say so.
 */
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../../../tests/fixtures/catalogue/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
};

/* The Worker serves every page cross-origin isolated, which is what gives
   the voice its threads (server/src/assets.ts says why, and why the strict
   mode). The suite serves the build the same way, so a cross-origin load the
   policy would block fails here rather than on the first phone, and the
   browser can be asked whether the isolation actually took. */
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};
const headersFor = (type: string): Record<string, string> =>
  (type === 'text/html' ? { 'content-type': type, ...ISOLATION } : { 'content-type': type });

/** A recording the server does not have, which is the case that used to fail
 *  in the console and nowhere else. The fixture names it for one word. */
export const MISSING_CLIP = 'gone.mp3';

/* Every file the fixture export writes, including the dictionary shards the
   words screen fetches a letter at a time. */
const CATALOGUE: Record<string, string> = Object.fromEntries(
  readdirSync(FIXTURE).filter((name) => name.endsWith('.json')).map((name) =>
    [`/catalogue/${name}`, readFileSync(join(FIXTURE, name), 'utf8')]));

/* One second of silence, so every clip is a real audio file the element can
   play to the end. */
function silence(): Buffer {
  const samples = 8000;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

export interface Serving { url: string; close: () => Promise<void> }

export async function serveBuild(): Promise<Serving> {
  await stat(join(BUILD, 'index.html')).catch(() => {
    throw new Error('the app has not been built: run `npm run build` first');
  });
  const quiet = silence();
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const canned = CATALOGUE[path];
    if (canned) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(canned);
      return;
    }
    if (path.startsWith('/media/')) {
      /* A file that is not there is a 404, the way the Worker answers one: it
         used to be the app's own HTML with a 200 on it. */
      if (path.endsWith(`/${MISSING_CLIP}`)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(quiet.length) });
      res.end(quiet);
      return;
    }
    /* Every route is prerendered; anything else is the single-page fallback,
       which is what the Worker does. */
    const file = join(BUILD, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const target = extname(file) ? file : join(BUILD, 'index.html');
    stat(target).then(
      () => {
        res.writeHead(200, headersFor(TYPES[extname(target)] ?? 'application/octet-stream'));
        createReadStream(target).pipe(res);
      },
      () => {
        res.writeHead(200, headersFor('text/html'));
        createReadStream(join(BUILD, 'index.html')).pipe(res);
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}
