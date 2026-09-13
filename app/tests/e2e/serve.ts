/** The built app, served the way the Worker serves it in production.
 *
 *  The catalogue is content the pipeline builds, and is not in the repository,
 *  so the end-to-end suite ships its own: a handful of words, answered from
 *  here rather than from disk. That makes the browser tests run anywhere the
 *  app has been built, with the same words every time.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
};

/** A recording the server does not have, which is the case that used to fail
 *  in the console and nowhere else. */
export const MISSING_CLIP = 'gone.mp3';

/** A verb, with the smallest table that is still a real one: a card about a
 *  verb shows how it behaves, and that is the part a card looked back at once
 *  lost. */
const PARLER = {
  lemma: 'parler', aux: 'avoir', shape: 'regular -er',
  groups: [{
    id: 'pres', mood: 'Indicatif', tense: 'Présent', stem: 'parl', irregular: false, note: '',
    rows: [
      { p: 'je', s: 'parl', e: 'e', f: 'parle', alt: false, dup: false },
      { p: 'tu', s: 'parl', e: 'es', f: 'parles', alt: false, dup: false },
      { p: 'il', s: 'parl', e: 'e', f: 'parle', alt: false, dup: true },
      { p: 'nous', s: 'parl', e: 'ons', f: 'parlons', alt: false, dup: false },
      { p: 'vous', s: 'parl', e: 'ez', f: 'parlez', alt: false, dup: false },
      { p: 'ils', s: 'parl', e: 'ent', f: 'parlent', alt: false, dup: false },
    ],
  }],
  compound: [], impersonal: [{ label: 'Infinitif', form: 'parler' }], links: [], examples: {},
};

/** Words enough to study: two that read as English and two that do not, so a
 *  session has both entry rungs in it, and a verb, which is the only kind of
 *  card that has more on it than a word. */
export const WORDS = [
  { k: 'nation|noun', fr: 'la nation', en: ['nation'], lemma: 'nation', answer: 'la nation',
    pos: 'noun', gender: 'f', ipa: '/na.sjɔ̃/', lvl: 1, m: 0.004, looks: 0.95, sounds: 0.3,
    audio: 'w1.mp3', native: null, cue: 'nation', cue_audio: 'w1-en.mp3' },
  { k: 'parler|verb', fr: 'parler', en: ['to speak'], lemma: 'parler', answer: 'parler',
    pos: 'verb', ipa: '/paʁ.le/', lvl: 1, m: 0.006, looks: 0.3, sounds: 0.2,
    audio: 'w5.mp3', native: null, cue: 'to speak', cue_audio: 'w5-en.mp3', conj: PARLER },
  { k: 'jour|noun', fr: 'le jour', en: ['day'], lemma: 'jour', answer: 'le jour',
    pos: 'noun', gender: 'm', ipa: '/ʒuʁ/', lvl: 1, m: 0.003, looks: 0.2, sounds: 0.1,
    audio: 'w2.mp3', native: null, cue: 'day', cue_audio: 'w2-en.mp3' },
  { k: 'train|noun', fr: 'le train', en: ['train'], lemma: 'train', answer: 'le train',
    pos: 'noun', gender: 'm', ipa: '/tʁɛ̃/', lvl: 1, m: 0.002, looks: 0.9, sounds: 0.6,
    audio: 'w3.mp3', native: null, cue: 'train', cue_audio: 'w3-en.mp3' },
  { k: 'pont|noun', fr: 'le pont', en: ['bridge'], lemma: 'pont', answer: 'le pont',
    pos: 'noun', gender: 'm', ipa: '/pɔ̃/', lvl: 1, m: 0.001, looks: 0.1, sounds: 0.1,
    audio: 'w4.mp3', native: null, cue: 'bridge', cue_audio: 'w4-en.mp3' },
  /* Last, and its recording is not there: a word the catalogue was rebuilt
     without. Every test that answers only the first few cards never meets it,
     and the one that does is about what the card says when nothing can be
     played. */
  { k: 'oubli|noun', fr: "l'oubli", en: ['oblivion'], lemma: 'oubli', answer: "l'oubli",
    pos: 'noun', gender: 'm', ipa: '/u.bli/', lvl: 1, m: 0.0005, looks: 0.1, sounds: 0.1,
    audio: MISSING_CLIP, native: null, cue: 'oblivion', cue_audio: MISSING_CLIP },
];

const CATALOGUE: Record<string, unknown> = {
  '/catalogue/meta.json': { v: 1, generated: 0, levelSize: 100, levels: [1], words: WORDS.length,
    verbs: 1, ceiling: 0.01, directions: [], examples: '' },
  '/catalogue/index.json': { v: 1,
    words: WORDS.map(({ k, fr, en, lvl, m, looks, sounds }) =>
      ({ k, fr, en, lvl, m, looks, sounds })) },
  '/catalogue/level-01.json': { v: 1, level: 1, words: WORDS },
};

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
      res.end(JSON.stringify(canned));
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
        res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
        createReadStream(target).pipe(res);
      },
      () => {
        res.writeHead(200, { 'content-type': 'text/html' });
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
