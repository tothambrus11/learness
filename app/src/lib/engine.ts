/** Which voice says a thing.
 *
 *  Two voices can say French here: the on-device one, Supertonic, a 380 MB
 *  download the learner agrees to once; and the browser's own, which costs
 *  nothing and is already on most phones. Until the download, the browser's is
 *  the fallback for everything the catalogue has no recording of. After it,
 *  the browser's is not used at all: the learner paid for the good voice, and
 *  a card that read its sentences in the cheap one while the good one sat on
 *  the device was #44 — the sentences were routed to speech.ts by one screen
 *  and the words to tts.ts by another, and nothing decided between them.
 *
 *  So the deciding is here, once, as a table: what is on the device, what
 *  kind of thing is to be said, which voice says it. Every source list the
 *  player is handed (audio.ts) is built from this answer, and no screen asks
 *  the browser's voice anything on its own.
 */
import { canSayIn } from './speech.js';
import { generationState } from './tts.js';

/** The voice that says something: the on-device one, the browser's own, or
 *  none — a device with neither, where the text stays on the page and the
 *  card says so. */
export type Engine = 'supertonic' | 'browser' | 'none';

/** The kinds of thing said aloud. Everything but the cue is French. */
export type SpeechKind = 'word' | 'cue' | 'sentence' | 'form';

/** What this device can say with: the on-device voice, which speaks both
 *  languages once it is here, and the browser's own, per language — a phone
 *  with an English voice and no French one is common. */
export interface Speakers {
  model: boolean;
  browser: { fr: boolean; en: boolean };
}

/** A device that can say nothing: the safe answer before anyone has looked. */
export const NO_SPEAKERS: Speakers = { model: false, browser: { fr: false, en: false } };

/** The language a kind of thing is said in. */
export const langOf = (kind: SpeechKind): 'fr' | 'en' => (kind === 'cue' ? 'en' : 'fr');

/** The rule. The on-device voice, once here, says everything — words,
 *  sentences, forms, the English cue alike; until then the browser's says what
 *  it can; and a device with neither says so rather than mispronouncing French
 *  in an English voice. Pure, so it is tested as the table it is. */
export function engineFor(speakers: Speakers, kind: SpeechKind): Engine {
  if (speakers.model) return 'supertonic';
  return speakers.browser[langOf(kind)] ? 'browser' : 'none';
}

/** What this device can say with, now. The model's presence can change while
 *  a screen is open — Make audio fetches it — so a screen asks again after
 *  that rather than keeping the first answer. */
export async function speakersHere(): Promise<Speakers> {
  const [state, fr, en] = await Promise.all([generationState(), canSayIn('fr'), canSayIn('en')]);
  return { model: state === 'ready', browser: { fr, en } };
}
