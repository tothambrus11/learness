/** Where a word's sound comes from.
 *
 *  Catalogue words have files on the server, which the service worker keeps
 *  once played. Your own words have clips made on this device by the voice in
 *  tts.js, kept in the database; those are handed out as object URLs, created
 *  once per session.
 */
import { base } from '$app/paths';
import { cueOf, phraseFor } from './cardface.js';
import { clipId, getClip } from './db.js';
import { engineFor, langOf } from './engine.js';
import type { Speakers, SpeechKind } from './engine.js';
import { HEARD_FIRST } from './keys.js';
import type { Rung } from './keys.js';
import type { Clip, StudyWord } from './model.js';
import type { Source } from './player.js';
import type { StudyItem } from './queue.js';
import { CUE_SLOT, ENGINE, WORD_SLOT, clipText } from './tts.js';

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
  /** A clip is being made on the device; it takes a moment, and the button
   *  says so rather than appearing to do nothing. Only while it is actually
   *  being made: a clip already here plays at once, and the button saying
   *  "making it" over a cached sentence was #34. */
  making: boolean;
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

/** A URL for a clip made on this device, kept for the session: the same clip
 *  hovered twice is one object URL, not two. */
export function clipSrc(clip: Clip | null | undefined): string | null {
  if (!clip) return null;
  const made = urls.get(clip.id);
  if (made) return made;
  const url = URL.createObjectURL(clip.blob);
  urls.set(clip.id, url);
  return url;
}

/** How a text with no recording is said: by the on-device voice where it is
 *  here, by the browser's where it is not, and by nothing where the device has
 *  neither — one source or none, never both. Which is `engineFor`'s answer:
 *  the sentences once went to the browser's voice while the on-device one sat
 *  there downloaded (#44), because the two were tried in turn by one screen
 *  and only the browser's by another. A device that has the on-device voice
 *  is not offered the browser's behind it: a voice that fails to make a clip
 *  is reported (tts.ts) and the card says nothing could be heard, rather than
 *  a cheaper voice quietly standing in for the one that was paid for.
 *
 *  The phrase is kept under its slot so the second hearing is instant, and
 *  never starts the 380 MB download: a sentence is not worth it. */
export function spokenSources(
  key: string, slot: string, text: string, kind: SpeechKind, speakers: Speakers,
): Source[] {
  if (!text) return [];
  const lang = langOf(kind);
  switch (engineFor(speakers, kind)) {
    case 'supertonic': return [{ phrase: { key, slot, text, lang } }];
    case 'browser': {
      const say: Source = { say: text, lang: lang === 'en' ? 'en-GB' : 'fr-FR' };
      /* A sentence is read a shade slower than a word; the on-device voice
         paces itself. */
      return [kind === 'sentence' || kind === 'form' ? { ...say, rate: 0.9 } : say];
    }
    default: return [];
  }
}

/** Where a word's sound comes from, in the order the player tries them: the
 *  recording, then a voice on the device saying the same thing. 'fr' and
 *  'native' say the French; 'en' says the cue. `speakers` is what this device
 *  can say with (engine.ts), which decides which voice that is. */
export function wordSources(word: StudyWord, kind: Sound, speakers: Speakers): Source[] {
  const file: Source = { file: () => srcFor(word, kind) };
  return kind === 'en'
    ? [file, ...spokenSources(word.k, CUE_SLOT, cueOf(word), 'cue', speakers)]
    : [file, ...spokenSources(word.k, WORD_SLOT, word.answer || word.fr, 'word', speakers)];
}

/** Where a card's phrase comes from — the sentence on a card about a
 *  sentence, the line on a card about a form. Empty for a card with no phrase.
 *  The catalogue ships no recording of a sentence — there are tens of
 *  thousands — so this is always a voice on the device, whichever it has. */
export function sentenceSources(item: StudyItem, speakers: Speakers): Source[] {
  const phrase = phraseFor(item);
  if (!phrase) return [];
  return spokenSources(item.word.k, phrase.slot, phrase.text,
    item.card.rung === 'voice' ? 'form' : 'sentence', speakers);
}

/** Whether a card's face may offer to make the word's audio.
 *
 *  Only where what it makes — the French — can then be played from that
 *  face: the back of any card, where the sound buttons are, and the front of
 *  a card asked by ear, which plays the French as its question. On the front
 *  of a "say it in French" card the English is showing and the French is the
 *  answer, so there is nothing the button could make that the face may play:
 *  the learner pressed it, watched the voice work, and was left with a face
 *  that had nothing to press (#51). */
export const voiceWorkOffered = (rung: Rung, revealed: boolean): boolean =>
  revealed || HEARD_FIRST.has(rung);

/** Forget an object URL after a clip is remade or removed. */
export function forgetSrc(key: string): void {
  for (const kind of ['fr', 'en'] as const) {
    const id = clipId(key, kind, ENGINE);
    const url = urls.get(id);
    if (url) { URL.revokeObjectURL(url); urls.delete(id); }
  }
}
