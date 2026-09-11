/** The browser's own voice. It speaks the English cue for a word with no
 *  recorded one, and French the catalogue has no recording of. Speaking only:
 *  nothing here listens. */

/** Does this device have a speech engine at all? False on the server, where
 *  there is no window, and on a browser without the API. */
export const canSpeak = (): boolean =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  typeof SpeechSynthesisUtterance !== 'undefined';

/** The voice list, asked for once. Null until something wants to speak. */
let voicesLoaded: Promise<SpeechSynthesisVoice[]> | null = null;

/** How long to wait for the voice list before taking whatever the engine
 *  lists, so a card is never left silent waiting on one. */
const VOICES_TIMEOUT_MS = 1500;

/** The device's voices, asked for once and kept. Resolves on whichever of the
 *  list, the event and the timeout comes first, with an empty list where the
 *  engine said nothing. */
function voices(): Promise<SpeechSynthesisVoice[]> {
  /* Some engines have the voices at once, some fire `voiceschanged` a moment
     later, and some never answer at all. */
  if (!voicesLoaded) {
    voicesLoaded = new Promise((resolve) => {
      const have = speechSynthesis.getVoices();
      if (have.length) return resolve(have);
      speechSynthesis.addEventListener(
        'voiceschanged',
        () => resolve(speechSynthesis.getVoices()),
        { once: true },
      );
      setTimeout(() => resolve(speechSynthesis.getVoices()), VOICES_TIMEOUT_MS);
    });
  }
  return voicesLoaded;
}

/** Which regions to prefer, most wanted first: Swiss French for a learner in
 *  Valais, British English for the same person's ear. */
const PREFERRED: Record<string, string[]> = { fr: ['fr-ch', 'fr-fr'], en: ['en-gb'] };

/** The voice to speak a language with, or null where the list holds none for
 *  it: a preferred region first, then whichever the device itself calls the
 *  default for that language, then any of them. Pure. */
export function pickVoice(
  all: SpeechSynthesisVoice[] = [],
  lang = 'en',
): SpeechSynthesisVoice | null {
  const base = lang.slice(0, 2).toLowerCase();
  const mine = all.filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith(base));
  if (!mine.length) return null;
  for (const want of PREFERRED[base] ?? []) {
    const hit = mine.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(want));
    if (hit) return hit;
  }
  return mine.find((v) => v.default) || mine[0];
}

/** True where this device can say something in this language, as far as the
 *  engine will admit. */
export async function canSayIn(lang: string): Promise<boolean> {
  if (!canSpeak()) return false;
  const all = await voices();
  /* An engine that lists no voices may still have some, so that case is a yes. */
  return !all.length || !!pickVoice(all, lang);
}

/** How something is to be said. */
interface SayOptions {
  /** The language tag to pick a voice by, region included. */
  lang?: string;
  /** Speed, as the engine's own multiplier; slightly under 1 for a learner. */
  rate?: number;
}

/** How long to wait for an utterance before calling it dropped: a second, plus
 *  time in proportion to the text. */
const dropTimeout = (text: string): number => 1000 + text.length * 120;

/** Speak `text`. Resolves true once it has been said, false where it could not
 *  be: a device with no engine, no voice for the language, or an utterance the
 *  engine dropped. Never hangs and never rejects, so a card cannot stall on a
 *  silent device. */
export async function say(
  text: string,
  { lang = 'en-GB', rate = 0.95 }: SayOptions = {},
): Promise<boolean> {
  if (!canSpeak() || !text) return false;
  const all = await voices();
  const voice = pickVoice(all, lang);
  const noVoiceForLanguage = !voice && all.length > 0;
  if (noVoiceForLanguage) return false;
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
    setTimeout(() => done(false), dropTimeout(text));
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/** Stop whatever is being said, at once. Safe on a device that cannot speak. */
export function hush(): void {
  if (canSpeak()) speechSynthesis.cancel();
}
