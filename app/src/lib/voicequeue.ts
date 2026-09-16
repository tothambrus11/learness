/** One voice, one queue, and an order of wanting.
 *
 *  The on-device voice is a single worker that takes a second or two a phrase,
 *  so everything that wants it has to take turns. Two kinds of wanting share
 *  the turn: a learner hovering a verb form, who wants it *now*, and the
 *  sitting's own preparation, which wants everything eventually and nothing
 *  urgently. Without a queue between them the preparation wins by being first,
 *  and the hover — the only one with a person waiting on it — is served after
 *  thirty clips it did not ask for.
 *
 *  So: asking for a phrase puts it at the head and hands back a promise;
 *  warming puts phrases at the tail; and `prefer` moves a word's waiting
 *  phrases to the front, which is what the card on screen does when it
 *  appears. One phrase is made at a time, because the worker can only do one.
 *
 *  Nothing here ever starts the 380 MB download. A device without the voice
 *  makes nothing, says so by handing back null, and the caller falls back to
 *  the browser's own voice.
 */
import { getSettings } from './db.js';
import { generationState, phraseClip } from './tts.js';
import { FIRST_TENSES, phrasesOf } from './conjspeech.js';
import type { Clip, StudyWord } from './model.js';
import type { Phrase } from './conjspeech.js';

/** What a queue does for its callers. */
export interface VoiceQueue {
  /** Say this one now: it goes to the head of the queue, and the promise is
   *  the clip, or null where this device cannot make one. */
  want: (phrase: Phrase) => Promise<Clip | null>;
  /** Make these when there is nothing more urgent. Returns at once. */
  warm: (phrases: readonly Phrase[]) => void;
  /** Move everything waiting for this word to the front, behind whatever is
   *  already being made: the word on screen is the one about to be hovered. */
  prefer: (key: string) => void;
  /** How many phrases are still waiting. */
  readonly waiting: number;
  /** Forget everything not yet started. What is being made finishes. */
  clear: () => void;
}

interface Job extends Phrase {
  id: string;
  /** Someone is waiting on this one rather than it being prepared. */
  urgent: boolean;
  settle: ((clip: Clip | null) => void)[];
}

const idOf = (phrase: Phrase): string => `${phrase.key}#${phrase.slot}`;

/** A queue over a way of making clips. The maker is a parameter so that the
 *  ordering can be tested without a voice, which no test machine has. */
export function createVoiceQueue(
  make: (phrase: Phrase) => Promise<Clip | null> = defaultMake,
): VoiceQueue {
  const queue: Job[] = [];
  let running = false;

  const push = (phrase: Phrase, { urgent }: { urgent: boolean }): Job | null => {
    if (!phrase.text || !phrase.key || !phrase.slot) return null;
    const id = idOf(phrase);
    const have = queue.find((job) => job.id === id);
    if (have) {
      /* Already waiting, and now someone is waiting on it: it moves up. */
      if (urgent && !have.urgent) {
        have.urgent = true;
        queue.splice(queue.indexOf(have), 1);
        queue.unshift(have);
      }
      return have;
    }
    const job: Job = { ...phrase, id, urgent, settle: [] };
    if (urgent) queue.unshift(job);
    else queue.push(job);
    return job;
  };

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const job = queue.shift()!;
        let clip: Clip | null = null;
        try {
          clip = await make(job);
        } catch {
          clip = null;                  /* a phrase that will not be made is silent */
        }
        for (const settle of job.settle) settle(clip);
      }
    } finally {
      running = false;
    }
  }

  return {
    want(phrase: Phrase): Promise<Clip | null> {
      const job = push(phrase, { urgent: true });
      if (!job) return Promise.resolve(null);
      const waited = new Promise<Clip | null>((resolve) => { job.settle.push(resolve); });
      void drain();
      return waited;
    },
    warm(phrases: readonly Phrase[]): void {
      for (const phrase of phrases) push(phrase, { urgent: false });
      void drain();
    },
    prefer(key: string): void {
      const mine = queue.filter((job) => job.key === key);
      if (!mine.length) return;
      for (const job of mine) queue.splice(queue.indexOf(job), 1);
      queue.unshift(...mine);
    },
    get waiting(): number { return queue.length; },
    clear(): void { queue.length = 0; },
  };
}

/** The real maker: the on-device voice, and only where it is already here.
 *  Asking for a phrase must never be what starts a 380 MB download. A phrase
 *  says which language it is in; French unless it says otherwise. */
async function defaultMake(phrase: Phrase): Promise<Clip | null> {
  if (await generationState() !== 'ready') return null;
  return phraseClip(phrase.key, phrase.slot, phrase.text, phrase.lang ?? 'fr');
}

/** The app's queue. One voice, so one of these. */
export const voices: VoiceQueue = createVoiceQueue();

/** May anything be made before it is asked for?
 *
 *  Two ways it may not: the learner has turned preparation off, and the voice
 *  is not on this device — in which case making one clip means fetching 380 MB
 *  first, which is never something to do on a guess about what will be
 *  hovered.
 */
export async function eagerAllowed(): Promise<boolean> {
  if (await generationState() !== 'ready') return false;
  const settings = await getSettings();
  return settings.eagerVoice !== false;
}

/** Prepare what this sitting is likely to want said: the present tense of
 *  every verb in it, in the order the cards come.
 *
 *  This is the "before you meet it" half of the setting. The other half is the
 *  table itself, which asks for the rest of its tenses when it is opened, and
 *  for one line the moment it is hovered.
 */
export async function warmSitting(
  words: readonly StudyWord[], queue: VoiceQueue = voices,
): Promise<number> {
  if (!(await eagerAllowed())) return 0;
  const phrases = words.flatMap((w) => phrasesOf(w.k, w.conj, FIRST_TENSES));
  queue.warm(phrases);
  return phrases.length;
}
