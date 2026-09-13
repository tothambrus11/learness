/** Where a word's sound comes from.
 *
 *  Catalogue words have files on the server, which the service worker keeps
 *  once played. Your own words have clips made on this device by the voice in
 *  tts.js, kept in the database; those are handed out as object URLs, created
 *  once per session.
 */
import { base } from '$app/paths';
import { clipId, getClip } from './db.js';
import type { StudyWord } from './model.js';
import { ENGINE, clipText, sentenceClip } from './tts.js';

/** Which recording of a word: the French prompt, a human's reading of it, or
 *  the English cue. */
export type Sound = 'fr' | 'native' | 'en';

/** Everything a card can do with sound, handed to it by the screen that owns
 *  the sitting.
 *
 *  The card offers the buttons; the screen knows which card is live, what is
 *  already playing and what has to be made first. Passing it as one record
 *  means the card asks for a sound the same way whether it is the card being
 *  answered or one being looked back at.
 */
export interface CardAudio {
  /** Which recordings this word has: the French, a human reading it, the
   *  English cue. */
  has: { fr: boolean; native: boolean; en: boolean };
  /** The device can say this card's sentence in French itself. */
  spoken: boolean;
  /** The English cue can be heard at all: a recording of it, or a voice on
   *  this device that will read it. */
  canCue: boolean;
  /** A sentence is being synthesised; it takes a moment, and the button says
   *  so rather than appearing to do nothing. */
  speaking: boolean;
  /** Why nothing could be heard, in words, or empty. A recording that the
   *  server no longer has is the case this exists for: it used to fail in the
   *  console and nowhere else. */
  trouble: string;
  /** The word's own recording. */
  play: (kind?: Sound) => void;
  /** What to compare your answer against: the sentence on a "use it" card,
   *  the word everywhere else. */
  playModel: () => void;
  /** The English cue, spoken. */
  cue: () => void;
}

const urls = new Map<string, string>();

const fileFor = (word: StudyWord, kind: Sound): string | null | undefined =>
  (kind === 'native' ? (word.native || word.audio)
    : kind === 'en' ? word.cue_audio
      : (word.audio || word.native));

/** kind: 'fr' (the prompt), 'native' (a human recording, else the prompt), 'en' (the cue).
 *
 *  A clip made before the word was corrected is not handed out: it says the old
 *  thing, and playing it would teach the correction away. The screen finds out
 *  through clipsState and offers to make it again. */
export async function srcFor(
  word: StudyWord | null | undefined, kind: Sound = 'fr',
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
  const made = urls.get(id);
  if (made) return made;
  const url = URL.createObjectURL(clip.blob);
  urls.set(id, url);
  return url;
}

/** An example sentence in the voice the cards use, where this device has it.
 *  Null means it has not been fetched, and the caller falls back. */
export async function sentenceSrc(
  word: StudyWord | null | undefined, index: number, text: string,
): Promise<string | null> {
  const clip = await sentenceClip(word?.k ?? null, index, text);
  if (!clip) return null;
  const made = urls.get(clip.id);
  if (made) return made;
  const url = URL.createObjectURL(clip.blob);
  urls.set(clip.id, url);
  return url;
}

/** Forget an object URL after a clip is remade or removed. */
export function forgetSrc(key: string): void {
  for (const kind of ['fr', 'en'] as const) {
    const id = clipId(key, kind, ENGINE);
    const url = urls.get(id);
    if (url) { URL.revokeObjectURL(url); urls.delete(id); }
  }
}
