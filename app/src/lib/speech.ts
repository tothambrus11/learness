/** The browser's own voice.
 *
 *  It speaks two things: the English cue for a word with no recorded one, and
 *  French that the catalogue has no recording of. That second case is
 *  the example sentences — there are tens of thousands of them and no pipeline
 *  audio, and the on-device voice is a 380 MB download nobody should owe for a
 *  sentence. The browser's French voice costs nothing and is already there on
 *  a phone; where a device has none, the caller falls back to the word's own
 *  recording.
 *
 *  There is deliberately no listening here. A recogniser is biased toward real
 *  words and quietly corrects a mispronunciation, and it drops the article —
 *  which is the gender — so it could never grade the thing the card teaches.
 *  Saying the word is judged by the person who said it.
 */

/** Does this device have a speech engine at all? False on the server, where
 *  there is no window, and on a browser without the API. */
export const canSpeak = (): boolean =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  typeof SpeechSynthesisUtterance !== 'undefined';

/** The voice list, asked for once. Null until something wants to speak. */
let voicesLoaded: Promise<SpeechSynthesisVoice[]> | null = null;
/** The device's voices, however long they take to arrive.
 *
 *  Some engines have them at once, some fire `voiceschanged` a moment later,
 *  and some never answer at all — so this resolves on whichever comes first
 *  and gives up after a second and a half rather than leaving a card silent. */
function voices(): Promise<SpeechSynthesisVoice[]> {
  if (!voicesLoaded) {
    voicesLoaded = new Promise((resolve) => {
      const have = speechSynthesis.getVoices();
      if (have.length) return resolve(have);
      speechSynthesis.addEventListener(
        'voiceschanged',
        () => resolve(speechSynthesis.getVoices()),
        { once: true },
      );
      setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
    });
  }
  return voicesLoaded;
}

/** Which regions to prefer, most wanted first: Swiss French for a learner in
 *  Valais, British English for the same person's ear. */
const PREFERRED: Record<string, string[]> = { fr: ['fr-ch', 'fr-fr'], en: ['en-gb'] };

/** The voice to speak a language with. Pure, so the preference order can be
 *  tested without a speech engine. */
export function pickVoice(
  all: SpeechSynthesisVoice[] = [],
  lang = 'en',
): SpeechSynthesisVoice | null {
  const base = lang.slice(0, 2).toLowerCase();
  const mine = all.filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith(base));
  if (!mine.length) return null;
  /* A named region first, then whichever voice the device itself calls the
     default for that language, then any of them. */
  for (const want of PREFERRED[base] ?? []) {
    const hit = mine.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(want));
    if (hit) return hit;
  }
  return mine.find((v) => v.default) || mine[0];
}

/** Can this device say something in this language? As far as the engine will
 *  admit: an engine that lists no voices at all has not necessarily none, so
 *  that case is given the benefit of the doubt and settled by trying. */
export async function canSayIn(lang: string): Promise<boolean> {
  if (!canSpeak()) return false;
  const all = await voices();
  return !all.length || !!pickVoice(all, lang);
}

/** How something is to be said. */
interface SayOptions {
  /** The language tag to pick a voice by, region included. */
  lang?: string;
  /** Speed, as the engine's own multiplier; slightly under 1 for a learner. */
  rate?: number;
}

/** Resolves when the utterance has been spoken, false when it could not be —
 *  so a card never stalls on a silent device, and a caller with a recording to
 *  fall back on knows to use it. */
export async function say(
  text: string,
  { lang = 'en-GB', rate = 0.95 }: SayOptions = {},
): Promise<boolean> {
  if (!canSpeak() || !text) return false;
  const all = await voices();
  const voice = pickVoice(all, lang);
  /* No voice for this language, on an engine that does list its voices: say so
     rather than mispronouncing French in an English voice. */
  if (!voice && all.length) return false;
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang || lang;
    try {
      if (voice) u.voice = voice;
    } catch {
      /* the engine picks one by lang */
    }
    u.rate = rate;
    let settled = false;
    /** Answers the caller once and once only: several of the paths below can
     *  fire, and the first one is the true one. */
    const done = (ok: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    u.onend = () => done(true);
    u.onerror = () => done(false);
    /* Some engines never fire onend for an utterance they dropped. */
    setTimeout(() => done(false), 1000 + text.length * 120);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/** Stop whatever is being said, at once. Safe on a device that cannot speak. */
export function hush(): void {
  if (canSpeak()) speechSynthesis.cancel();
}
