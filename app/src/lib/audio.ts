/** Where a word's sound comes from: a file on the server for a catalogue word,
 *  a clip made on this device for one of your own. */

import { base } from '$app/paths';

import { clipId, getClip } from './db';
import { ENGINE, clipText, sentenceClip } from './tts';
import type { StudyWord, WordKey } from './types';

/** Which recording of a word is wanted: the synthesised French prompt, a
 *  human recording of it where the catalogue found one, or the English cue. */
export type AudioKind = 'fr' | 'native' | 'en';

/** Object URLs handed out this session, by clip id. One URL per clip, so a
 *  card that comes round twice does not leak a second, and `forgetSrc` has
 *  something to revoke when the clip behind one is remade. */
const urls = new Map<string, string>();

/** The catalogue's file for a word, or nothing where it has none. `native`
 *  prefers the human recording and falls back to the synthesised prompt; `fr`
 *  prefers the prompt, since that is the voice the deck is taught in. */
const fileFor = (word: StudyWord, kind: AudioKind): string | null | undefined =>
  kind === 'native'
    ? word.native || word.audio
    : kind === 'en'
      ? word.cue_audio
      : word.audio || word.native;

/** The URL to play a word from, or null where this device has none. `kind` is
 *  'fr' (the prompt), 'native' (a human recording, else the prompt) or 'en'
 *  (the cue). A clip made before the word was corrected counts as none. */
export async function srcFor(
  word: StudyWord | null | undefined,
  kind: AudioKind = 'fr',
): Promise<string | null> {
  if (!word) return null;
  const file = fileFor(word, kind);
  if (file) return `${base}/media/${file}`;
  if (!word.user) return null;
  const want = kind === 'en' ? 'en' : 'fr';
  const clip = await getClip(clipId(word.k, want, ENGINE));
  if (!clip) return null;
  if (clip.text !== clipText(word, want)) return null;
  const id = clip.id;
  if (urls.has(id)) return urls.get(id) ?? null;
  const url = URL.createObjectURL(clip.blob);
  urls.set(id, url);
  return url;
}

/** An example sentence in the voice the cards use, where this device has it.
 *  Null means it has not been fetched, and the caller falls back. */
export async function sentenceSrc(
  word: StudyWord | null | undefined,
  index: number,
  text: string,
): Promise<string | null> {
  const clip = await sentenceClip(word?.k, index, text);
  if (!clip) return null;
  if (urls.has(clip.id)) return urls.get(clip.id) ?? null;
  const url = URL.createObjectURL(clip.blob);
  urls.set(clip.id, url);
  return url;
}

/** Forget an object URL after a clip is remade or removed. */
export function forgetSrc(key: WordKey): void {
  for (const kind of ['fr', 'en'] as const) {
    const id = clipId(key, kind, ENGINE);
    const url = urls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urls.delete(id);
    }
  }
}
