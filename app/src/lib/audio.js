/** Where a word's sound comes from.
 *
 *  Catalogue words have files on the server, which the service worker keeps
 *  once played. Your own words have clips made on this device by the voice in
 *  tts.js, kept in the database; those are handed out as object URLs, created
 *  once per session.
 */
import { base } from '$app/paths';
import { clipId, getClip } from './db.js';
import { ENGINE } from './tts.js';

const urls = new Map();

const fileFor = (word, kind) => (kind === 'native' ? (word.native || word.audio)
  : kind === 'en' ? word.cue_audio
    : (word.audio || word.native));

/** kind: 'fr' (the prompt), 'native' (a human recording, else the prompt), 'en' (the cue). */
export async function srcFor(word, kind = 'fr') {
  if (!word) return null;
  const file = fileFor(word, kind);
  if (file) return `${base}/media/${file}`;
  if (!word.user) return null;
  const clip = await getClip(clipId(word.k, kind === 'en' ? 'en' : 'fr', ENGINE));
  if (!clip) return null;
  const id = clip.id;
  if (urls.has(id)) return urls.get(id);
  const url = URL.createObjectURL(clip.blob);
  urls.set(id, url);
  return url;
}

/** Forget an object URL after a clip is remade or removed. */
export function forgetSrc(key) {
  for (const kind of ['fr', 'en']) {
    const id = clipId(key, kind, ENGINE);
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  }
}
